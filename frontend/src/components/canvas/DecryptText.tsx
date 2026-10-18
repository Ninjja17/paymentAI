import React, { useState, useEffect } from 'react';

interface DecryptTextProps {
  text: string;
  speed?: number;
  className?: string;
  characters?: string;
}

const DEFAULT_CHARS = '01#@$%&*<>~/\\';

export const DecryptText: React.FC<DecryptTextProps> = ({
  text,
  speed = 28,
  className = '',
  characters = DEFAULT_CHARS,
}) => {
  const [displayText, setDisplayText] = useState(text);

  useEffect(() => {
    let iteration = 0;
    const maxIterations = text.length;

    const interval = setInterval(() => {
      setDisplayText(
        text
          .split('')
          .map((char, index) => {
            if (index < iteration) {
              return text[index];
            }
            if (char === ' ') return ' ';
            return characters[Math.floor(Math.random() * characters.length)];
          })
          .join('')
      );

      if (iteration >= maxIterations) {
        clearInterval(interval);
      }

      iteration += 1 / 2;
    }, speed);

    return () => clearInterval(interval);
  }, [text, speed, characters]);

  return <span className={`decrypt-text ${className}`}>{displayText}</span>;
};
