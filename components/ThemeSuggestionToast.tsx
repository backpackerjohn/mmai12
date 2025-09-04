import React, { useEffect, useState } from 'react';
import { ThemeName } from '../types';
import WandIcon from './icons/WandIcon';

interface ThemeSuggestionToastProps {
    suggestion: ThemeName | null;
    onAccept: () => void;
    onDismiss: () => void;
}

const ThemeSuggestionToast: React.FC<ThemeSuggestionToastProps> = ({ suggestion, onAccept, onDismiss }) => {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        if (suggestion) {
            setIsVisible(true);
        } else {
            setIsVisible(false);
        }
    }, [suggestion]);

    if (!isVisible || !suggestion) {
        return null;
    }

    return (
        <div
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[70] bg-[var(--color-surface)] rounded-xl shadow-2xl p-4 w-full max-w-md border border-[var(--color-border)] flex items-center gap-4 animate-fade-in"
            role="alert"
            aria-live="assertive"
        >
            <div className="flex-shrink-0 h-10 w-10 bg-[var(--color-primary-accent)]/20 rounded-full flex items-center justify-center">
                <WandIcon className="h-6 w-6 text-[var(--color-primary-accent)]" />
            </div>
            <div className="flex-1">
                <p className="font-semibold text-[var(--color-text-primary)]">Theme Suggestion</p>
                <p className="text-sm text-[var(--color-text-secondary)]">
                    Based on your context, we recommend switching to the "{suggestion}" theme.
                </p>
            </div>
            <div className="flex gap-2">
                 <button onClick={onDismiss} className="px-3 py-1.5 text-sm font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-sunken)] rounded-md">
                     Dismiss
                 </button>
                <button onClick={onAccept} className="px-3 py-1.5 text-sm font-semibold text-[var(--color-primary-accent-text)] bg-[var(--color-primary-accent)] hover:bg-[var(--color-primary-accent-hover)] rounded-md">
                    Accept
                </button>
            </div>
        </div>
    );
};

export default ThemeSuggestionToast;
