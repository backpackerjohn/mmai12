import React, { useState, useEffect } from 'react';

interface AddReminderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (text: string) => Promise<void>;
}

const AddReminderModal: React.FC<AddReminderModalProps> = ({ isOpen, onClose, onSubmit }) => {
    const [inputText, setInputText] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) {
            setInputText('');
            setIsProcessing(false);
            setError(null);
        }
    }, [isOpen]);

    const handleSubmit = async () => {
        if (!inputText.trim()) return;
        setIsProcessing(true);
        setError(null);
        try {
            await onSubmit(inputText);
            // Parent component will close the modal on success
        } catch (e: any) {
            setError(e.message || "An unexpected error occurred.");
        } finally {
            setIsProcessing(false);
        }
    };
    
    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 bg-black bg-opacity-60 z-[60] flex items-center justify-center p-4"
            onClick={onClose}
            role="dialog" aria-modal="true" aria-labelledby="add-reminder-title"
        >
            <div
                className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-lg transform transition-all"
                onClick={e => e.stopPropagation()}
            >
                <h2 id="add-reminder-title" className="text-2xl font-bold text-stone-800 mb-2">Add a Smart Reminder</h2>
                <p className="text-stone-600 mb-4">Describe your reminder, and we'll schedule it intelligently based on your anchors.</p>

                <div>
                    <label htmlFor="reminder-input" className="block text-sm font-semibold text-stone-700 mb-1">What do you want to be reminded of?</label>
                    <textarea
                        id="reminder-input"
                        value={inputText}
                        onChange={e => setInputText(e.target.value)}
                        placeholder="e.g., 'Remind me to pack lunch 30 minutes before work'"
                        className="w-full h-28 p-3 border border-stone-300 rounded-lg focus:ring-2 focus:ring-[#C75E4A] resize-none"
                        autoFocus
                    />
                </div>

                {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

                <div className="mt-6 flex justify-end gap-3">
                    <button onClick={onClose} className="px-5 py-2 font-semibold text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-lg">
                        Cancel
                    </button>
                    <button 
                        onClick={handleSubmit} 
                        disabled={isProcessing || !inputText.trim()}
                        className="px-5 py-2 font-semibold text-white bg-[#C75E4A] hover:bg-opacity-90 rounded-lg shadow-sm disabled:bg-stone-400 flex items-center"
                    >
                         {isProcessing && (
                            <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                        )}
                        {isProcessing ? 'Scheduling...' : 'Create Reminder'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AddReminderModal;
