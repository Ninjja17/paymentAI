"""Create backend storage and version existing session rows."""

from datetime import datetime, timezone
import uuid

from alembic import op
import sqlalchemy as sa

revision = "0001_backend_foundation"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    if "intake_sessions" not in tables:
        op.create_table(
            "intake_sessions",
            sa.Column("session_id", sa.String(length=40), primary_key=True),
            sa.Column("status", sa.String(length=20), nullable=False),
            sa.Column("user_name", sa.String(length=200)),
            sa.Column("initial_goal", sa.Text()),
            sa.Column("intake_stage", sa.String(length=40), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("brief_readiness_score", sa.Float(), nullable=False),
            sa.Column("metadata_json", sa.JSON(), nullable=False),
            sa.Column("extracted_facts", sa.JSON(), nullable=False),
            sa.Column("brief_json", sa.JSON()),
            sa.Column("state_version", sa.Integer(), nullable=False, server_default="1"),
        )
    else:
        columns = {column["name"] for column in inspector.get_columns("intake_sessions")}
        if "state_version" not in columns:
            op.add_column(
                "intake_sessions",
                sa.Column("state_version", sa.Integer(), nullable=False, server_default="1"),
            )

    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "session_turns" not in tables:
        op.create_table(
            "session_turns",
            sa.Column("turn_id", sa.String(length=80), primary_key=True),
            sa.Column(
                "session_id",
                sa.String(length=40),
                sa.ForeignKey("intake_sessions.session_id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("role", sa.String(length=20), nullable=False),
            sa.Column("agent_name", sa.String(length=100)),
            sa.Column("message", sa.Text(), nullable=False),
            sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_session_turns_session_id", "session_turns", ["session_id"])

    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "session_credentials" not in tables:
        op.create_table(
            "session_credentials",
            sa.Column(
                "session_id",
                sa.String(length=40),
                sa.ForeignKey("intake_sessions.session_id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column("token_hash", sa.String(length=64), nullable=False, unique=True),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        )
    if "voice_tickets" not in tables:
        op.create_table(
            "voice_tickets",
            sa.Column("ticket_hash", sa.String(length=64), primary_key=True),
            sa.Column(
                "session_id",
                sa.String(length=40),
                sa.ForeignKey("intake_sessions.session_id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("consumed_at", sa.DateTime(timezone=True)),
        )
        op.create_index("ix_voice_tickets_session_id", "voice_tickets", ["session_id"])
    revision_table_created = "session_revisions" not in tables
    if revision_table_created:
        op.create_table(
            "session_revisions",
            sa.Column("revision_id", sa.String(length=36), primary_key=True),
            sa.Column(
                "session_id",
                sa.String(length=40),
                sa.ForeignKey("intake_sessions.session_id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("revision", sa.Integer(), nullable=False),
            sa.Column("state_json", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("session_id", "revision", name="uq_session_revision"),
        )
        op.create_index("ix_session_revisions_session_id", "session_revisions", ["session_id"])
        session_table = sa.Table(
            "intake_sessions",
            sa.MetaData(),
            autoload_with=op.get_bind(),
        )
        revision_table = sa.Table(
            "session_revisions",
            sa.MetaData(),
            autoload_with=op.get_bind(),
        )
        for row in op.get_bind().execute(sa.select(session_table)).mappings():
            state = {
                "status": row["status"],
                "user_name": row["user_name"],
                "initial_goal": row["initial_goal"],
                "intake_stage": row["intake_stage"],
                "brief_readiness_score": row["brief_readiness_score"],
                "metadata": row["metadata_json"],
                "extracted_facts": row["extracted_facts"],
                "brief": row["brief_json"],
            }
            op.get_bind().execute(
                revision_table.insert().values(
                    revision_id=str(uuid.uuid4()),
                    session_id=row["session_id"],
                    revision=row["state_version"],
                    state_json=state,
                    created_at=datetime.now(timezone.utc),
                )
            )


def downgrade() -> None:
    op.drop_table("session_revisions")
    op.drop_table("voice_tickets")
    op.drop_table("session_credentials")
    op.drop_index("ix_session_turns_session_id", table_name="session_turns")
    op.drop_table("session_turns")
    op.drop_column("intake_sessions", "state_version")
