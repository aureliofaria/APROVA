import { useState } from 'react';

interface LogoProps {
  variant?: 'color' | 'white';
  className?: string;
  showApprova?: boolean;
}

/**
 * Logo Gol Plus + wordmark APROVA.
 * Tenta carregar o PNG oficial em /logo-golplus.png (ou branco). Caso o arquivo
 * ainda não exista (onError), exibe um wordmark de fallback com as cores da marca:
 * "gol" + pin-com-"+" + "plus", e abaixo o nome do produto "APROVA".
 */
export default function Logo({ variant = 'color', className = '', showApprova = true }: LogoProps) {
  const [imgError, setImgError] = useState(false);
  const src = variant === 'white' ? '/logo-golplus-branco.png' : '/logo-golplus.png';
  const isWhite = variant === 'white';

  if (!imgError) {
    return (
      <div className={`flex items-center gap-3 ${className}`}>
        <img
          src={src}
          alt="Gol Plus"
          onError={() => setImgError(true)}
          className="h-10 w-auto object-contain"
        />
        {showApprova && (
          <span className={`font-bold tracking-wide text-sm ${isWhite ? 'text-white' : 'text-golplus-blue'}`}>
            APROVA
          </span>
        )}
      </div>
    );
  }

  // Fallback wordmark
  const golColor = isWhite ? 'text-white' : 'text-golplus-blue';
  const plusColor = isWhite ? 'text-white' : 'text-golplus-blue';

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="flex items-center font-extrabold text-2xl lowercase select-none">
        <span className={golColor}>gol</span>
        {/* location pin combinado com "+" */}
        <span className="mx-0.5 inline-flex items-center justify-center" aria-hidden="true">
          <svg width="22" height="26" viewBox="0 0 22 26" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M11 1C5.477 1 1 5.477 1 11c0 6.5 10 14 10 14s10-7.5 10-14C21 5.477 16.523 1 11 1z"
              fill="#F47C20"
            />
            <path d="M11 6v8M7 10h8" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        </span>
        <span className={plusColor}>plus</span>
      </div>
      {showApprova && (
        <span className={`font-bold tracking-wide text-xs mt-1 ${isWhite ? 'text-white/90' : 'text-golplus-orange'}`}>
          APROVA
        </span>
      )}
    </div>
  );
}
