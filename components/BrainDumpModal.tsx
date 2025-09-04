import React, { useState, useEffect } from 'react';

interface BrainDumpModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (text: string) => Promise<void>;
}

const BrainDumpModal: React.FC<BrainDumpModalProps> = ({ isOpen, onClose, onSubmit }) => {
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  const handleSubmit = async () => {
    if (!inputText.trim()) return;
    setIsProcessing(true);
    try {
      await onSubmit(inputText);
      setInputText('');
      onClose();
    } catch (error) {
      // Error will be handled in the parent component
      console.error("Submission failed", error);
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4 transition-opacity duration-300"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="brain-dump-modal-title"
    >
      <div 
        className="bg-[var(--color-surface)] rounded-[var(--border-radius-xl)] shadow-2xl p-8 w-full max-w-2xl transform transition-all duration-300 scale-100"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="brain-dump-modal-title" className="text-3xl font-bold text-[var(--color-text-primary)] mb-4">
          Quick Brain Dump
        </h2>
        <p className="text-[var(--color-text-secondary)] mb-6">
          Capture what's on your mind. We'll organize it for you on the Brain Dump page.
        </p>
        <textarea 
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="e.g., Follow up with Sarah about the Q3 report, need to buy milk, idea for new marketing slogan..." 
          className="w-full h-48 p-4 bg-transparent border border-[var(--color-border)] rounded-[var(--border-radius-md)] focus:ring-2 focus:ring-[var(--color-primary-accent)] transition-shadow resize-none" 
          aria-label="Brain dump input"
          autoFocus
        />
        <div className="mt-6 flex justify-end items-center space-x-4">
          <button 
            onClick={onClose} 
            className="px-6 py-3 font-semibold text-[var(--color-text-secondary)] bg-[var(--color-surface-sunken)] hover:bg-[var(--color-border)] rounded-[var(--border-radius-md)] transition-all"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={isProcessing || !inputText.trim()} 
            className="px-6 py-3 font-semibold text-[var(--color-primary-accent-text)] bg-[var(--color-primary-accent)] rounded-[var(--border-radius-md)] hover:bg-[var(--color-primary-accent-hover)] transition-all shadow-md disabled:bg-stone-400 disabled:cursor-not-allowed flex items-center"
          >
            {isProcessing && (
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            )}
            {isProcessing ? 'Processing...' : 'Process Thoughts'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BrainDumpModal;