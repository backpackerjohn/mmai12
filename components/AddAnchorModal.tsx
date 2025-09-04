import React, { useState, useEffect } from 'react';
import { ScheduleEvent } from '../types';

interface AddAnchorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: { title: string; startTime: string; endTime: string; days: ScheduleEvent['day'][] }) => void;
}

const DAYS_OF_WEEK: { long: ScheduleEvent['day']; short: string }[] = [
    { long: 'Monday', short: 'Mon' },
    { long: 'Tuesday', short: 'Tue' },
    { long: 'Wednesday', short: 'Wed' },
    { long: 'Thursday', short: 'Thu' },
    { long: 'Friday', short: 'Fri' },
    { long: 'Saturday', short: 'Sat' },
    { long: 'Sunday', short: 'Sun' },
];

const AddAnchorModal: React.FC<AddAnchorModalProps> = ({ isOpen, onClose, onSave }) => {
    const [title, setTitle] = useState('');
    const [startTime, setStartTime] = useState('09:00');
    const [endTime, setEndTime] = useState('10:00');
    const [selectedDays, setSelectedDays] = useState<ScheduleEvent['day'][]>([]);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) {
            // Reset state on close
            setTitle('');
            setStartTime('09:00');
            setEndTime('10:00');
            setSelectedDays([]);
            setError(null);
        }
    }, [isOpen]);

    const handleToggleDay = (day: ScheduleEvent['day']) => {
        setSelectedDays(prev => 
            prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
        );
    };

    const handleSubmit = () => {
        setError(null);
        if (!title.trim()) {
            setError("Every anchor needs a name!");
            return;
        }
        if (!startTime || !endTime) {
            setError("Don't forget to set the start and end times.");
            return;
        }
        if (selectedDays.length === 0) {
            setError("Which day(s) should this be on?");
            return;
        }
        if (new Date(`1970-01-01T${startTime}`) >= new Date(`1970-01-01T${endTime}`)) {
            setError("Oops! The end time needs to be after the start time.");
            return;
        }

        onSave({ title, startTime, endTime, days: selectedDays });
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 bg-black bg-opacity-60 z-[60] flex items-center justify-center p-4"
            onClick={onClose}
            role="dialog" aria-modal="true" aria-labelledby="add-anchor-title"
        >
            <div
                className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md transform transition-all"
                onClick={e => e.stopPropagation()}
            >
                <h2 id="add-anchor-title" className="text-2xl font-bold text-stone-800 mb-4">Add a New Anchor</h2>
                <div className="space-y-4">
                    <div>
                        <label htmlFor="anchor-title" className="block text-sm font-semibold text-stone-700 mb-1">Anchor Name</label>
                        <input
                            id="anchor-title"
                            type="text"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            placeholder="e.g., Gym Session, Kids' Soccer"
                            className="w-full p-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-[#C75E4A]"
                            autoFocus
                        />
                    </div>
                    <div className="flex gap-4">
                        <div className="flex-1">
                            <label htmlFor="start-time" className="block text-sm font-semibold text-stone-700 mb-1">Start Time</label>
                            <input
                                id="start-time"
                                type="time"
                                value={startTime}
                                onChange={e => setStartTime(e.target.value)}
                                className="w-full p-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-[#C75E4A]"
                            />
                        </div>
                        <div className="flex-1">
                            <label htmlFor="end-time" className="block text-sm font-semibold text-stone-700 mb-1">End Time</label>
                            <input
                                id="end-time"
                                type="time"
                                value={endTime}
                                onChange={e => setEndTime(e.target.value)}
                                className="w-full p-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-[#C75E4A]"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-stone-700 mb-2">Repeats On</label>
                        <div className="flex flex-wrap gap-2">
                            {DAYS_OF_WEEK.map(day => (
                                <button
                                    key={day.long}
                                    onClick={() => handleToggleDay(day.long)}
                                    className={`px-3 py-1.5 text-sm font-semibold rounded-full border-2 transition-colors ${
                                        selectedDays.includes(day.long) 
                                        ? 'bg-[#C75E4A] text-white border-[#C75E4A]' 
                                        : 'bg-white text-stone-600 border-stone-300 hover:border-[#C75E4A]'
                                    }`}
                                >
                                    {day.short}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {error && <p className="text-sm text-red-600 mt-4">{error}</p>}

                <div className="mt-6 flex justify-end gap-3">
                    <button onClick={onClose} className="px-5 py-2 font-semibold text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-lg">
                        Cancel
                    </button>
                    <button onClick={handleSubmit} className="px-5 py-2 font-semibold text-white bg-[#C75E4A] hover:bg-opacity-90 rounded-lg shadow-sm">
                        Save Anchor
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AddAnchorModal;