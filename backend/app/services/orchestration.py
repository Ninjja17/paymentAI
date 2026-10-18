"""LangGraph workflow for bounded, multi-agent intake turns."""

from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from app.models.schemas import (
    EvidenceCriticOutput,
    InterviewAgentOutput,
    OrchestratorOutput,
    ProblemAnalystOutput,
    SynthesisValidationOutput,
)
from app.services.gemini import GeminiAgents


class IntakeGraphState(TypedDict):
    agents: GeminiAgents
    context: dict[str, Any]
    user_input: str
    speaker_tag: str | None
    decision: OrchestratorOutput | None
    evidence_review: EvidenceCriticOutput | None
    analyst: ProblemAnalystOutput | None
    interview: InterviewAgentOutput | None


class BriefGraphState(TypedDict):
    agents: GeminiAgents
    context: dict[str, Any]
    additional_notes: str | None
    latest_user_input: str
    force_synthesis: bool
    readiness_threshold: float
    result: SynthesisValidationOutput | None
    analyst: ProblemAnalystOutput | None
    follow_up: InterviewAgentOutput | None


def _orchestrate(state: IntakeGraphState) -> dict[str, Any]:
    evidence_review = state["evidence_review"]
    context = state["context"]
    evidence_data = None
    if evidence_review is not None:
        evidence_data = evidence_review.model_dump(mode="json")
        context = {
            **context,
            "agent_state": {
                **context.get("agent_state", {}),
                "evidence_review": evidence_data,
            },
        }

    decision = state["agents"].orchestrate(
        context,
        latest_user_input=state["user_input"],
        evidence_review=evidence_data,
    )
    if (
        evidence_review is not None
        and decision.next_action == "investigate_claims"
    ):
        decision = decision.model_copy(update={"next_action": "follow_up"})
    return {"context": context, "decision": decision}


def _route_after_orchestration(state: IntakeGraphState) -> str:
    decision = state["decision"]
    if decision is None:
        raise RuntimeError("The orchestration node did not produce a decision.")
    if decision.next_action == "investigate_claims":
        return "review_evidence"
    if decision.next_action == "follow_up":
        return "analyze_problem"
    return "interview"


def _review_evidence(state: IntakeGraphState) -> dict[str, EvidenceCriticOutput]:
    decision = state["decision"]
    if decision is None:
        raise RuntimeError("Evidence review requires an orchestration decision.")
    return {
        "evidence_review": state["agents"].review_evidence(
            state["context"],
            decision.claims_requiring_review,
        )
    }


def _analyze_problem(state: IntakeGraphState) -> dict[str, ProblemAnalystOutput]:
    decision = state["decision"]
    if decision is None:
        raise RuntimeError("Problem analysis requires an orchestration decision.")
    evidence_review = state["evidence_review"]
    evidence_data = (
        evidence_review.model_dump(mode="json")
        if evidence_review is not None
        else state["context"].get("agent_state", {}).get("evidence_review")
    )
    return {
        "analyst": state["agents"].analyze_problem(
            state["context"],
            orchestrator_rationale=decision.rationale,
            evidence_review=evidence_data,
        )
    }


def _interview(state: IntakeGraphState) -> dict[str, InterviewAgentOutput]:
    decision = state["decision"]
    if decision is None:
        raise RuntimeError("The interview node requires an orchestration decision.")
    analyst = state["analyst"]
    interview = state["agents"].interview(
        session_context=state["context"],
        latest_user_input=state["user_input"],
        speaker_tag=state["speaker_tag"],
        analyst_guidance=analyst.recommended_question if analyst else None,
        ready_for_synthesis=decision.next_action == "ready_for_synthesis",
    )
    if decision.next_action == "ready_for_synthesis":
        interview = interview.model_copy(update={"intake_stage": "ready"})
    elif interview.intake_stage == "ready":
        interview = interview.model_copy(update={"intake_stage": "clarification"})
    return {"interview": interview}


def _build_turn_graph():
    graph = StateGraph(IntakeGraphState)
    graph.add_node("orchestrate", _orchestrate)
    graph.add_node("review_evidence", _review_evidence)
    graph.add_node("analyze_problem", _analyze_problem)
    graph.add_node("interview", _interview)
    graph.add_edge(START, "orchestrate")
    graph.add_conditional_edges(
        "orchestrate",
        _route_after_orchestration,
        {
            "review_evidence": "review_evidence",
            "analyze_problem": "analyze_problem",
            "interview": "interview",
        },
    )
    graph.add_edge("review_evidence", "orchestrate")
    graph.add_edge("analyze_problem", "interview")
    graph.add_edge("interview", END)
    return graph.compile()


def _synthesize_brief(state: BriefGraphState) -> dict[str, SynthesisValidationOutput]:
    return {
        "result": state["agents"].synthesize_and_validate(
            session_context=state["context"],
            additional_notes=state["additional_notes"],
        )
    }


def _brief_needs_clarification(state: BriefGraphState) -> str:
    result = state["result"]
    if result is None:
        raise RuntimeError("Brief synthesis did not produce a result.")
    needs_clarification = (
        not result.passed_validation
        or (
            result.readiness_score < state["readiness_threshold"]
            and not state["force_synthesis"]
        )
    )
    return "analyze_gaps" if needs_clarification else "complete"


def _brief_validation_issues(state: BriefGraphState) -> list[str]:
    result = state["result"]
    if result is None:
        raise RuntimeError("Brief analysis requires a synthesis result.")
    issues = list(result.validation_issues)
    if (
        result.readiness_score < state["readiness_threshold"]
        and not state["force_synthesis"]
        and "Synthesis readiness is below the required threshold." not in issues
    ):
        issues.append("Synthesis readiness is below the required threshold.")
    return issues


def _analyze_brief_gaps(state: BriefGraphState) -> dict[str, ProblemAnalystOutput]:
    evidence_review = state["context"].get("agent_state", {}).get("evidence_review")
    rationale = (
        "The synthesis validation agent found material gaps or contradictions: "
        + "; ".join(_brief_validation_issues(state))
    )
    return {
        "analyst": state["agents"].analyze_problem(
            state["context"],
            orchestrator_rationale=rationale,
            evidence_review=evidence_review,
        )
    }


def _ask_brief_follow_up(state: BriefGraphState) -> dict[str, InterviewAgentOutput]:
    analyst = state["analyst"]
    if analyst is None:
        raise RuntimeError("A follow-up interview requires problem analysis.")
    return {
        "follow_up": state["agents"].interview(
            session_context=state["context"],
            latest_user_input=state["latest_user_input"],
            analyst_guidance=analyst.recommended_question,
        )
    }


def _build_brief_graph():
    graph = StateGraph(BriefGraphState)
    graph.add_node("synthesize", _synthesize_brief)
    graph.add_node("analyze_gaps", _analyze_brief_gaps)
    graph.add_node("ask_follow_up", _ask_brief_follow_up)
    graph.add_edge(START, "synthesize")
    graph.add_conditional_edges(
        "synthesize",
        _brief_needs_clarification,
        {"analyze_gaps": "analyze_gaps", "complete": END},
    )
    graph.add_edge("analyze_gaps", "ask_follow_up")
    graph.add_edge("ask_follow_up", END)
    return graph.compile()


_turn_graph = _build_turn_graph()
_brief_graph = _build_brief_graph()


def run_turn_agents(
    agents: GeminiAgents,
    context: dict[str, Any],
    user_input: str,
    speaker_tag: str | None,
) -> tuple[
    InterviewAgentOutput,
    OrchestratorOutput,
    EvidenceCriticOutput | None,
    ProblemAnalystOutput | None,
]:
    """Run one bounded intake turn through the compiled agent graph."""
    result = _turn_graph.invoke(
        {
            "agents": agents,
            "context": context,
            "user_input": user_input,
            "speaker_tag": speaker_tag,
            "decision": None,
            "evidence_review": None,
            "analyst": None,
            "interview": None,
        }
    )
    decision = result["decision"]
    interview = result["interview"]
    if decision is None or interview is None:
        raise RuntimeError("The intake graph ended without a complete turn result.")
    return interview, decision, result["evidence_review"], result["analyst"]


def run_brief_agents(
    agents: GeminiAgents,
    context: dict[str, Any],
    additional_notes: str | None,
    latest_user_input: str,
    force_synthesis: bool,
    readiness_threshold: float,
) -> tuple[
    SynthesisValidationOutput,
    list[str],
    ProblemAnalystOutput | None,
    InterviewAgentOutput | None,
]:
    """Run brief synthesis and route failed validation into a follow-up interview."""
    result = _brief_graph.invoke(
        {
            "agents": agents,
            "context": context,
            "additional_notes": additional_notes,
            "latest_user_input": latest_user_input,
            "force_synthesis": force_synthesis,
            "readiness_threshold": readiness_threshold,
            "result": None,
            "analyst": None,
            "follow_up": None,
        }
    )
    synthesis = result["result"]
    if synthesis is None:
        raise RuntimeError("The brief graph ended without a synthesis result.")
    if result["follow_up"] is not None:
        return (
            synthesis,
            _brief_validation_issues(result),
            result["analyst"],
            result["follow_up"],
        )
    return synthesis, [], None, None
