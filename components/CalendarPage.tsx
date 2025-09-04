import React, { useState, useMemo, useEffect } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { ScheduleEvent, SmartReminder, ReminderStatus, ContextTag, SuccessState, DNDWindow, MicroHabit, EnergyTag } from '../types';
import BellIcon from './icons/BellIcon';
import WandIcon from './icons/WandIcon';
import LockIcon from './icons/LockIcon';
import LockOpenIcon from './icons/LockOpenIcon';
import InfoIcon from './icons/InfoIcon';
import PauseIcon from './icons/PauseIcon';
import CalendarIcon from './icons/CalendarIcon';
import GearIcon from './icons/GearIcon';
import PlusIcon from './icons/PlusIcon';
import DuplicateIcon from './icons/DuplicateIcon';
import AddAnchorModal from './AddAnchorModal';
import AddReminderModal from './AddReminderModal';
import AiChat from './AiChat';
import { getAnchorColor } from '../utils/styles';
import { getHabitSuggestion } from '../utils/habitStacking';
import { recordHabitCompletion } from '../utils/habitAnalytics';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// --- CONSTANTS & HELPERS ---
const DAYS_OF_WEEK: ScheduleEvent['day'][] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const formatTimeForToast = (time: string): string => {
    if (!time) return '';
    const [hourStr, minuteStr] = time.split(':');
    let hour = parseInt(hourStr, 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12;
    hour = hour ? hour : 12; // the hour '0' should be '12'
    return `${hour}${minuteStr !== '00' ? `:${minuteStr}` : ''}${ampm}`;
};

export const formatDaysForToast = (days: ScheduleEvent['day'][]) => {
    if (days.length === 0) return '';
    const dayMap: Record<ScheduleEvent['day'], string> = {
        Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu',
        Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun'
    };
    const sortedDays = DAYS_OF_WEEK.filter(d => days.includes(d));

    if (days.length > 2) {
        if (sortedDays.join(',') === 'Monday,Tuesday,Wednesday,Thursday,Friday') return 'Mon–Fri';
        if (sortedDays.join(',') === 'Saturday,Sunday') return 'Sat–Sun';
        return sortedDays.map(d => dayMap[d]).join(', ');
    } else if (days.length === 2) {
        return sortedDays.map(d => dayMap[d]).join(' & ');
    } else if (days.length === 1) {
        return dayMap[sortedDays[0]];
    }
    return '';
};

export const formatOffsetForToast = (offsetMinutes: number) => {
    if (offsetMinutes === 0) return "at the start of";
    const minutes = Math.abs(offsetMinutes);
    const beforeOrAfter = offsetMinutes < 0 ? "before" : "after";
    return `${minutes} minute${minutes > 1 ? 's' : ''} ${beforeOrAfter}`;
};

const timeToMinutes = (time: string): number => {
    if (!time) return 0;
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
};

const minutesToTime = (minutes: number): string => {
    const h = Math.floor(minutes / 60) % 24;
    const m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const doTimesOverlap = (startA: string, endA: string, startB: string, endB: string): boolean => {
    const startAMin = timeToMinutes(startA);
    const endAMin = timeToMinutes(endA);
    const startBMin = timeToMinutes(startB);
    const endBMin = timeToMinutes(endB);
    return startAMin < endBMin && endAMin > startBMin;
};

const parseNaturalLanguageReminder = async (text: string, scheduleEvents: ScheduleEvent[]): Promise<{ anchorTitle: string; offsetMinutes: number; message: string; why: string }> => {
    const anchorTitles = [...new Set(scheduleEvents.map(e => e.title))];

    const schema = {
        type: Type.OBJECT,
        properties: {
            anchorTitle: {
                type: Type.STRING,
                description: "The title of the anchor event to link this reminder to. Must be an exact match from the provided list.",
                enum: anchorTitles.length > 0 ? anchorTitles : undefined,
            },
            offsetMinutes: {
                type: Type.NUMBER,
                description: "The offset in minutes from the anchor's start time. Negative for before, positive for after."
            },
            message: {
                type: Type.STRING,
                description: "The content of the reminder message for the user."
            },
            why: {
                type: Type.STRING,
                description: "A brief, friendly explanation for why this reminder is being set at this time."
            }
        },
        required: ["anchorTitle", "offsetMinutes", "message", "why"]
    };

    const prompt = `
        You are a helpful scheduling assistant. Parse the user's natural language request to create a structured reminder object.
        - The 'anchorTitle' MUST be an exact match from the provided list of available anchor titles.
        - Calculate 'offsetMinutes' based on the request (e.g., "10 minutes before" is -10, "at the start" is 0, "5 minutes after" is 5).
        - Extract the core reminder 'message'.
        - Create a simple 'why' message, like "Because you asked to be reminded."

        Available Anchor Titles:
        ${anchorTitles.join(', ')}

        User Request:
        "${text}"

        Return a single JSON object that strictly follows the provided schema.
    `;

    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: schema,
            },
        });
        const jsonStr = response.text.trim();
        const result = JSON.parse(jsonStr);
        if (anchorTitles.length > 0 && !anchorTitles.includes(result.anchorTitle)) {
             throw new Error(`Could not find an anchor named "${result.anchorTitle}". Please check the name.`);
        }
        return result;
    } catch (error) {
        console.error("Error parsing reminder with Gemini:", error);
        if (error instanceof Error && error.message.includes('Could not find an anchor')) {
            throw error;
        }
        throw new Error("I had trouble understanding that. Could you try rephrasing? e.g., 'Remind me to pack my gym bag 30 minutes before Gym Session'");
    }
};

// --- TYPE DEFINITIONS ---
type OnboardingPreviewData = { newAnchors: ScheduleEvent[]; newDnd: DNDWindow[] };
type SettingsData = {
    globalAllowExperiments: boolean;
    maxFollowUps: 0 | 1;
    autoPauseThreshold: number;
    stackingGuardrailEnabled: boolean;
};
type ConflictType = {
    type: 'dnd' | 'overlap';
    eventToMoveId: string;
    targetDay: ScheduleEvent['day'];
    overlappingEventId?: string;
};

interface CalendarPageProps {
    scheduleEvents: ScheduleEvent[];
    setScheduleEvents: React.Dispatch<React.SetStateAction<ScheduleEvent[]>>;
    smartReminders: SmartReminder[];
    setSmartReminders: React.Dispatch<React.SetStateAction<SmartReminder[]>>;
    dndWindows: DNDWindow[];
    setDndWindows: React.Dispatch<React.SetStateAction<DNDWindow[]>>;
    pauseUntil: string | null;
    setPauseUntil: React.Dispatch<React.SetStateAction<string | null>>;
    onboardingPreview: OnboardingPreviewData | null;
    setOnboardingPreview: React.Dispatch<React.SetStateAction<OnboardingPreviewData | null>>;
}
type ChangeHistoryItem = { id: number; message: string; undo: () => void; };
type UndoSnackbarData = { message: string; onUndo: () => void; };

// --- ONBOARDING COMPONENT ---
const OnboardingFlow: React.FC<{ 
    isOpen: boolean;
    onComplete: (data: OnboardingPreviewData) => void;
    onClose: () => void;
    onboardingPreview: OnboardingPreviewData | null;
    setOnboardingPreview: React.Dispatch<React.SetStateAction<OnboardingPreviewData | null>>;
}> = ({ isOpen, onComplete, onClose, onboardingPreview, setOnboardingPreview }) => {
    const [step, setStep] = useState(1);
    
    type TimeBlock = { id: number; startTime: string; endTime: string; days: ScheduleEvent['day'][] };
    const initialBlocks: TimeBlock[] = [{ id: Date.now(), startTime: '09:00', endTime: '17:00', days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] }];
    const [blocks, setBlocks] = useState<TimeBlock[]>(initialBlocks);
    const [activeBlockId, setActiveBlockId] = useState<number | null>(initialBlocks[0]?.id || null);
    const [customTime, setCustomTime] = useState<{ id: number; part: 'startTime' | 'endTime' } | null>(null);

    const initialDnd = { sleepStart: '23:00', sleepEnd: '07:00' };
    const [dndSettings, setDndSettings] = useState(initialDnd);
    
    const [generatedPreview, setGeneratedPreview] = useState<OnboardingPreviewData | null>(null);
    const [isCustomDnd, setIsCustomDnd] = useState(false);

    const generateDefaults = (): OnboardingPreviewData => {
        const newAnchors: ScheduleEvent[] = [];
        const newDnd: DNDWindow[] = [];
        const workDays: ScheduleEvent['day'][] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  
        workDays.forEach(day => {
          newAnchors.push({
            id: `onboard-work-${day}`,
            day,
            title: 'Work',
            startTime: '09:00',
            endTime: '17:00',
            contextTags: [ContextTag.Work, ContextTag.HighEnergy],
            bufferMinutes: { prep: 15 }
          });
        });
        
         newAnchors.push({
            id: `onboard-weekend-relax`,
            day: 'Saturday',
            title: 'Weekend Relaxation',
            startTime: '10:00',
            endTime: '12:00',
            contextTags: [ContextTag.Personal, ContextTag.Relaxed]
        });
  
        DAYS_OF_WEEK.forEach(day => {
          newDnd.push({
            day,
            startTime: '23:00',
            endTime: '07:00',
          });
        });
  
        return { newAnchors, newDnd };
    };

    useEffect(() => {
        if (isOpen) {
            if (onboardingPreview) {
                const anchorsByTime = onboardingPreview.newAnchors.reduce((acc, anchor) => {
                    const key = `${anchor.startTime}-${anchor.endTime}`;
                    const existing = acc[key];
                    const day = anchor.day as ScheduleEvent['day'];
                    if (existing) {
                        existing.days.push(day);
                    } else {
                        acc[key] = { startTime: anchor.startTime, endTime: anchor.endTime, days: [day] };
                    }
                    return acc;
                }, {} as Record<string, { startTime: string; endTime: string; days: ScheduleEvent['day'][] }>);

                const previewBlocks: TimeBlock[] = Object.values(anchorsByTime).map((blockData, index) => ({
                    id: Date.now() + index,
                    ...blockData
                }));

                if (previewBlocks.length > 0) {
                    setBlocks(previewBlocks);
                    setActiveBlockId(previewBlocks[0].id);
                }
                
                setGeneratedPreview(onboardingPreview);
                
                const dndWindow = onboardingPreview.newDnd[0];
                if (dndWindow) {
                    setDndSettings({
                        sleepStart: dndWindow.startTime,
                        sleepEnd: dndWindow.endTime,
                    });
                }
                setStep(4);
            } else {
                const newInitialBlocks: TimeBlock[] = [{ id: Date.now(), startTime: '09:00', endTime: '17:00', days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] }];
                setBlocks(newInitialBlocks);
                setActiveBlockId(newInitialBlocks[0].id);
                setStep(1);
                setGeneratedPreview(null);
                setDndSettings(initialDnd);
            }
        }
    }, [isOpen, onboardingPreview]);
    
    const handleClose = () => {
        if (step < 4 && !onboardingPreview) {
            const defaults = generateDefaults();
            setOnboardingPreview(defaults);
        }
        onClose();
    };

    const handleConfirm = () => {
        if (generatedPreview) {
            onComplete(generatedPreview);
            setOnboardingPreview(null);
        }
    };

    const generateAndPreview = () => {
        const newAnchors: ScheduleEvent[] = [];
        blocks.forEach((block, blockIndex) => {
            if (block.startTime && block.endTime && block.days.length > 0) {
                block.days.forEach(day => {
                    newAnchors.push({
                        id: `onboard-work-${blockIndex}-${day}`,
                        day: day,
                        title: 'Work/School',
                        startTime: block.startTime,
                        endTime: block.endTime,
                        contextTags: [ContextTag.Work, ContextTag.HighEnergy],
                        bufferMinutes: { prep: 15, recovery: 15 }
                    });
                });
            }
        });

        const newDnd: DNDWindow[] = [];
        const { sleepStart, sleepEnd } = dndSettings;
        DAYS_OF_WEEK.forEach(day => {
            newDnd.push({ day, startTime: sleepStart, endTime: sleepEnd });
        });
        
        setGeneratedPreview({ newAnchors, newDnd });
        setStep(4);
    };
    
    const formatTimeForDisplay = (time: string): string => {
        if (!time) return '';
        const [hourStr, minuteStr] = time.split(':');
        let hour = parseInt(hourStr, 10);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        hour = hour % 12;
        hour = hour ? hour : 12;
        return `${hour}${minuteStr !== '00' ? `:${minuteStr}` : ''} ${ampm}`;
    };
    
    const formatDays = (days: ScheduleEvent['day'][]) => {
        if (days.length === 0) return '';
        const dayMap: Record<ScheduleEvent['day'], string> = {
            Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu',
            Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun'
        };
        const sortedDays = DAYS_OF_WEEK.filter(d => days.includes(d));

        if (sortedDays.join(',') === 'Monday,Tuesday,Wednesday,Thursday,Friday') return 'Mon–Fri';
        if (sortedDays.join(',') === 'Saturday,Sunday') return 'Sat–Sun';
        if (sortedDays.length === 7) return 'Every day';

        return sortedDays.map(d => dayMap[d]).join(', ');
    };

    const updateBlock = (id: number, field: keyof Omit<TimeBlock, 'id'>, value: any) => {
        setBlocks(currentBlocks => currentBlocks.map(b => {
            if (b.id === id) {
                const updatedBlock = { ...b, [field]: value };
                if (field === 'startTime' && updatedBlock.endTime && timeToMinutes(value) >= timeToMinutes(updatedBlock.endTime)) {
                    updatedBlock.endTime = '';
                }
                return updatedBlock;
            }
            return b;
        }));
    };

    const toggleDay = (id: number, day: ScheduleEvent['day']) => {
        setBlocks(currentBlocks => currentBlocks.map(b => {
            if (b.id === id) {
                const newDays = b.days.includes(day)
                    ? b.days.filter(d => d !== day)
                    : [...b.days, day];
                return { ...b, days: newDays };
            }
            return b;
        }));
    };

    const addBlock = () => {
        const newBlock = { id: Date.now(), startTime: '', endTime: '', days: [] as ScheduleEvent['day'][] };
        setBlocks(currentBlocks => [...currentBlocks, newBlock]);
        setActiveBlockId(newBlock.id);
    };

    const removeBlock = (id: number) => {
        setBlocks(currentBlocks => {
            const newBlocks = currentBlocks.filter(b => b.id !== id);
            if (activeBlockId === id) {
                setActiveBlockId(newBlocks.length > 0 ? newBlocks[newBlocks.length - 1].id : null);
            }
            return newBlocks;
        });
    };

    if (!isOpen) {
        return null;
    }

    const dndOptions = [
        { label: '10 PM - 6 AM', start: '22:00', end: '06:00' },
        { label: '11 PM - 7 AM', start: '23:00', end: '07:00' },
        { label: '12 AM - 8 AM', start: '00:00', end: '08:00' },
    ];

    const renderStep = () => {
        switch (step) {
            case 1: return (
                <div>
                    <h2 className="text-3xl font-bold text-[var(--color-text-primary)]">Welcome! Let's set up your weekly rhythm.</h2>
                    <p className="mt-2 text-[var(--color-text-secondary)]">This helps us place reminders at the right time. We'll ask a few quick questions.</p>
                    <div className="mt-6 flex justify-center gap-4">
                        <button onClick={handleClose} className="px-6 py-3 font-semibold text-[var(--color-text-secondary)] bg-[var(--color-surface-sunken)] hover:bg-[var(--color-border)] rounded-lg">Skip for now</button>
                        <button onClick={() => setStep(2)} className="px-6 py-3 font-semibold text-[var(--color-primary-accent-text)] bg-[var(--color-primary-accent)] rounded-lg">Get Started</button>
                    </div>
                </div>
            );
            case 2:
                const startTimes = ['07:00', '08:00', '09:00', '10:00', '11:00', '12:00'];
                const endTimes = ['13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];
                const daysOfWeekMap: { short: string; long: ScheduleEvent['day'] }[] = [
                    { short: 'Mon', long: 'Monday' }, { short: 'Tue', long: 'Tuesday' }, { short: 'Wed', long: 'Wednesday' },
                    { short: 'Thu', long: 'Thursday' }, { short: 'Fri', long: 'Friday' }, { short: 'Sat', long: 'Saturday' },
                    { short: 'Sun', long: 'Sunday' },
                ];
                const validBlocks = blocks.filter(b => b.startTime && b.endTime && b.days.length > 0);
                const activeBlock = blocks.find(b => b.id === activeBlockId);

                return (
                    <div>
                        <h2 className="text-2xl font-bold text-[var(--color-text-primary)]">When do you usually work or have school?</h2>
                        <p className="mt-2 text-[var(--color-text-secondary)] max-w-lg mx-auto">Pick your start and end times, and select the days this applies to. You can always edit this later.</p>
                        
                        <div className="mt-4 space-y-2 max-h-60 overflow-y-auto pr-2 text-left">
                            {blocks.filter(b => b.id !== activeBlockId && b.startTime && b.endTime && b.days.length > 0).map(block => (
                                <div key={`summary-${block.id}`} onClick={() => setActiveBlockId(block.id)}
                                    className="p-3 border rounded-lg bg-[var(--color-surface)] cursor-pointer hover:bg-[var(--color-surface-sunken)] flex justify-between items-center animate-fade-in"
                                >
                                    <p className="text-sm text-[var(--color-text-primary)]">
                                        <span className="font-semibold">Work/School:</span> {formatTimeForDisplay(block.startTime)} – {formatTimeForDisplay(block.endTime)} ({formatDays(block.days)})
                                    </p>
                                    <button onClick={(e) => { e.stopPropagation(); removeBlock(block.id); }} className="p-1 text-[var(--color-text-subtle)] hover:text-[var(--color-danger)] rounded-full flex-shrink-0" title="Remove block">
                                       <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                                    </button>
                                </div>
                            ))}
                            {activeBlock && (
                                <div key={activeBlock.id} className="p-4 border-2 border-[var(--color-primary-accent)] rounded-lg bg-[var(--color-surface)] relative animate-fade-in">
                                    <div className="mb-3">
                                        <label className="font-semibold text-sm text-[var(--color-text-secondary)] block mb-2">Start Time</label>
                                        <div className="flex flex-wrap gap-2">
                                            {startTimes.map(st => (
                                                <button key={st} onClick={() => updateBlock(activeBlock.id, 'startTime', st)}
                                                    className={`px-3 py-1 text-sm font-semibold rounded-full border-2 transition-colors ${activeBlock.startTime === st ? 'bg-[var(--color-primary-accent)] text-[var(--color-primary-accent-text)] border-[var(--color-primary-accent)]' : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:border-[var(--color-primary-accent)]'}`}>
                                                    {formatTimeForDisplay(st)}
                                                </button>
                                            ))}
                                            {customTime?.id === activeBlock.id && customTime?.part === 'startTime' ? (
                                                <input type="time" defaultValue={activeBlock.startTime} onBlur={e => { if (e.target.value) updateBlock(activeBlock.id, 'startTime', e.target.value); setCustomTime(null); }} autoFocus className="p-1 border rounded-md text-sm w-28"/>
                                            ) : (
                                                <button onClick={() => setCustomTime({ id: activeBlock.id, part: 'startTime' })}
                                                    className={`px-3 py-1 text-sm font-semibold rounded-full border-2 transition-colors ${activeBlock.startTime && !startTimes.includes(activeBlock.startTime) ? 'bg-[var(--color-primary-accent)] text-[var(--color-primary-accent-text)] border-[var(--color-primary-accent)]' : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:border-[var(--color-primary-accent)]'}`}>
                                                    {activeBlock.startTime && !startTimes.includes(activeBlock.startTime) ? formatTimeForDisplay(activeBlock.startTime) : 'Custom'}
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    <div className="mb-3">
                                        <label className="font-semibold text-sm text-[var(--color-text-secondary)] block mb-2">End Time</label>
                                        <div className="flex flex-wrap gap-2">
                                            {endTimes.map(et => {
                                                const isDisabled = activeBlock.startTime ? timeToMinutes(et) <= timeToMinutes(activeBlock.startTime) : false;
                                                return (
                                                    <button key={et} disabled={isDisabled} onClick={() => updateBlock(activeBlock.id, 'endTime', et)}
                                                        className={`px-3 py-1 text-sm font-semibold rounded-full border-2 transition-colors ${activeBlock.endTime === et ? 'bg-[var(--color-primary-accent)] text-[var(--color-primary-accent-text)] border-[var(--color-primary-accent)]' : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)]'} ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-[var(--color-primary-accent)]'}`}>
                                                        {formatTimeForDisplay(et)}
                                                    </button>
                                                );
                                            })}
                                            {customTime?.id === activeBlock.id && customTime?.part === 'endTime' ? (
                                                <input type="time" defaultValue={activeBlock.endTime} onBlur={e => { if (e.target.value) updateBlock(activeBlock.id, 'endTime', e.target.value); setCustomTime(null); }} autoFocus className="p-1 border rounded-md text-sm w-28"/>
                                            ) : (
                                                <button onClick={() => setCustomTime({ id: activeBlock.id, part: 'endTime' })}
                                                    className={`px-3 py-1 text-sm font-semibold rounded-full border-2 transition-colors ${activeBlock.endTime && !endTimes.includes(activeBlock.endTime) ? 'bg-[var(--color-primary-accent)] text-[var(--color-primary-accent-text)] border-[var(--color-primary-accent)]' : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:border-[var(--color-primary-accent)]'}`}>
                                                    {activeBlock.endTime && !endTimes.includes(activeBlock.endTime) ? formatTimeForDisplay(activeBlock.endTime) : 'Custom'}
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    <div>
                                        <label className="font-semibold text-sm text-[var(--color-text-secondary)] block mb-2">On these days</label>
                                        <div className="flex flex-wrap gap-2">
                                            {daysOfWeekMap.map(day => (
                                                <button key={day.long} onClick={() => toggleDay(activeBlock.id, day.long)}
                                                    className={`w-12 py-1 text-sm font-semibold rounded-full border-2 transition-colors ${activeBlock.days.includes(day.long) ? 'bg-[var(--color-primary-accent)] text-[var(--color-primary-accent-text)] border-[var(--color-primary-accent)]' : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:border-[var(--color-primary-accent)]'}`}>
                                                    {day.short}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                        
                        <button onClick={addBlock} className="mt-4 w-full text-sm font-semibold text-[var(--color-primary-accent)] hover:bg-[var(--color-surface-sunken)] p-2 rounded-lg border-2 border-dashed border-[var(--color-border)] hover:border-[var(--color-primary-accent)] transition-colors">
                            + Add Another Block
                        </button>
                        
                        <div className="mt-6 flex justify-center gap-4">
                            <button onClick={() => setStep(1)} className="px-6 py-3 font-semibold text-[var(--color-text-secondary)] bg-[var(--color-surface-sunken)] hover:bg-[var(--color-border)] rounded-lg">Back</button>
                            <button onClick={() => setStep(3)} disabled={validBlocks.length === 0} className="px-6 py-3 font-semibold text-[var(--color-primary-accent-text)] bg-[var(--color-primary-accent)] rounded-lg disabled:bg-stone-400">Looks good →</button>
                        </div>
                    </div>
                );
            case 3: return (
                 <div>
                    <h2 className="text-2xl font-bold text-[var(--color-text-primary)]">When is your "Do Not Disturb" time?</h2>
                     <p className="mt-2 text-[var(--color-text-secondary)]">We'll avoid sending reminders during this window (e.g., when you're sleeping).</p>
                    <div className="mt-4 flex flex-wrap gap-3 justify-center">
                        {dndOptions.map(opt => (
                            <button
                                key={opt.label}
                                onClick={() => {
                                    setDndSettings({ sleepStart: opt.start, sleepEnd: opt.end });
                                    setIsCustomDnd(false);
                                }}
                                className={`px-4 py-2 font-semibold rounded-lg border-2 transition-colors ${
                                    dndSettings.sleepStart === opt.start && dndSettings.sleepEnd === opt.end && !isCustomDnd
                                    ? 'bg-[var(--color-primary-accent)] text-[var(--color-primary-accent-text)] border-[var(--color-primary-accent)]'
                                    : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:border-[var(--color-primary-accent)]'
                                }`}
                            >
                                {opt.label}
                            </button>
                        ))}
                        <button
                            onClick={() => setIsCustomDnd(true)}
                            className={`px-4 py-2 font-semibold rounded-lg border-2 transition-colors ${
                                isCustomDnd
                                ? 'bg-[var(--color-primary-accent)] text-[var(--color-primary-accent-text)] border-[var(--color-primary-accent)]'
                                : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:border-[var(--color-primary-accent)]'
                            }`}
                        >
                            Custom
                        </button>
                    </div>
                    {isCustomDnd && (
                        <div className="mt-4 flex gap-4 items-center justify-center animate-fade-in">
                            <label>From:</label>
                            <input type="time" value={dndSettings.sleepStart} onChange={e => setDndSettings(p => ({...p, sleepStart: e.target.value}))} className="p-2 border rounded-md" />
                            <span>to</span>
                            <input type="time" value={dndSettings.sleepEnd} onChange={e => setDndSettings(p => ({...p, sleepEnd: e.target.value}))} className="p-2 border rounded-md" />
                        </div>
                    )}
                    <div className="mt-6 flex justify-center gap-4">
                        <button onClick={() => setStep(2)} className="px-6 py-3 font-semibold text-[var(--color-text-secondary)] bg-[var(--color-surface-sunken)] hover:bg-[var(--color-border)] rounded-lg">Back</button>
                        <button onClick={generateAndPreview} className="px-6 py-3 font-semibold text-[var(--color-primary-accent-text)] bg-[var(--color-primary-accent)] rounded-lg">Preview My Map</button>
                    </div>
                </div>
            );
            case 4: return (
                 <div>
                    <h2 className="text-2xl font-bold text-[var(--color-text-primary)]">Here's your suggested weekly map.</h2>
                     <p className="mt-2 text-[var(--color-text-secondary)]">This is a starting point based on common routines. You can edit this now, or change it any time from the calendar.</p>
                     <div className="mt-4 bg-[var(--color-surface-sunken)] p-4 rounded-lg border max-h-60 overflow-y-auto text-left space-y-3">
                         <div>
                            <h3 className="font-bold text-[var(--color-text-primary)]">Core Anchors:</h3>
                            {generatedPreview?.newAnchors.map(a => (
                                <p key={a.id} className="text-sm text-[var(--color-text-secondary)] pl-2">&bull; {a.day}: {a.title} ({formatTimeForDisplay(a.startTime)} - {formatTimeForDisplay(a.endTime)})</p>
                            ))}
                         </div>
                         <div>
                             <h3 className="font-bold text-[var(--color-text-primary)]">Do-Not-Disturb Window:</h3>
                             <p className="text-sm text-[var(--color-text-secondary)] pl-2">&bull; Daily from {formatTimeForDisplay(generatedPreview?.newDnd[0].startTime || '')} to {formatTimeForDisplay(generatedPreview?.newDnd[0].endTime || '')}</p>
                         </div>
                     </div>
                    <div className="mt-6 flex justify-center gap-4">
                        <button onClick={() => setStep(2)} className="px-6 py-3 font-semibold text-[var(--color-text-secondary)] bg-[var(--color-surface-sunken)] rounded-lg hover:bg-[var(--color-border)]">Edit Details</button>
                        <button onClick={handleConfirm} className="px-6 py-3 font-semibold text-[var(--color-primary-accent-text)] bg-[var(--color-primary-accent)] rounded-lg hover:bg-[var(--color-primary-accent-hover)]">Confirm & Start</button>
                    </div>
                </div>
            );
            default: return null;
        }
    }

    return (
        <div 
            className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4 transition-opacity duration-300"
            onClick={handleClose}
            role="dialog"
            aria-modal="true"
            aria-labelledby="onboarding-title"
        >
            <div 
                className="bg-[var(--color-surface)] rounded-2xl shadow-2xl p-8 w-full max-w-2xl transform transition-all duration-300 scale-100 text-center relative flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                <button onClick={handleClose} className="absolute top-2 right-2 p-2 text-[var(--color-text-subtle)] hover:text-[var(--color-text-primary)] rounded-full hover:bg-[var(--color-surface-sunken)] transition-colors" aria-label="Close setup">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
                <div className="flex-grow">{renderStep()}</div>
                {step > 1 && step < 4 && (
                    <div className="mt-4">
                         <button onClick={handleClose} className="text-sm text-[var(--color-text-subtle)] hover:underline">Skip for now</button>
                    </div>
                )}
            </div>
        </div>
    );
};

// --- DND SETTINGS EDITOR ---
const DndSettingsEditor: React.FC<{
    dndWindows: DNDWindow[];
    setDndWindows: React.Dispatch<React.SetStateAction<DNDWindow[]>>;
    onSettingChange: (message: string, undoCallback: () => void) => void;
}> = ({ dndWindows, setDndWindows, onSettingChange }) => {

    const handleDndChange = (day: ScheduleEvent['day'], part: 'startTime' | 'endTime', value: string) => {
        const originalDnd = [...dndWindows];
        setDndWindows(prev => {
            const index = prev.findIndex(w => w.day === day);
            if (index > -1) {
                const newWindows = [...prev];
                newWindows[index] = { ...newWindows[index], [part]: value };
                return newWindows;
            }
            return prev;
        });
        onSettingChange('DND times updated.', () => setDndWindows(originalDnd));
    };
    
    const handleApplyToAll = () => {
        const originalDnd = [...dndWindows];
        const representativeWindow = dndWindows.find(w => w.day === 'Monday') || dndWindows[0] || { startTime: '23:00', endTime: '07:00' };
        setDndWindows(DAYS_OF_WEEK.map(day => ({
            day,
            startTime: representativeWindow.startTime,
            endTime: representativeWindow.endTime,
        })));
        onSettingChange("Applied Monday's DND to all days.", () => setDndWindows(originalDnd));
    };
    
    return (
        <div className="space-y-3">
            {DAYS_OF_WEEK.map(day => {
                const window = dndWindows.find(w => w.day === day) || { startTime: '', endTime: '' };
                return (
                    <div key={day} className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-[var(--color-text-secondary)] text-sm flex-shrink-0 w-20">{day}</span>
                        <div className="flex items-center gap-1">
                            <input type="time" value={window.startTime} onChange={e => handleDndChange(day, 'startTime', e.target.value)} className="p-1 border rounded-md text-sm w-full"/>
                            <span className="text-[var(--color-text-subtle)]">-</span>
                            <input type="time" value={window.endTime} onChange={e => handleDndChange(day, 'endTime', e.target.value)} className="p-1 border rounded-md text-sm w-full"/>
                        </div>
                    </div>
                );
            })}
             <div className="mt-4 pt-4 border-t">
                 <button onClick={handleApplyToAll} className="w-full text-sm font-semibold text-[var(--color-primary-accent)] hover:bg-[var(--color-surface-sunken)] p-2 rounded-lg transition-colors">
                    Apply Monday's time to all days
                </button>
            </div>
        </div>
    );
};

// --- SETTINGS PANEL ---
const SettingsPanel: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    settings: SettingsData;
    setSettings: React.Dispatch<React.SetStateAction<SettingsData>>;
    dndWindows: DNDWindow[];
    setDndWindows: React.Dispatch<React.SetStateAction<DNDWindow[]>>;
    addChangeToHistory: (message: string, undoCallback: () => void) => void;
}> = ({ isOpen, onClose, settings, setSettings, dndWindows, setDndWindows, addChangeToHistory }) => {
    if (!isOpen) return null;

    const handleSettingChange = <K extends keyof SettingsData>(key: K, value: SettingsData[K]) => {
        const oldSettings = { ...settings };
        const newSettings = { ...settings, [key]: value };
        setSettings(newSettings);
        addChangeToHistory(`Settings updated: ${key}.`, () => setSettings(oldSettings));
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 z-[60] flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-[var(--color-surface)] rounded-2xl shadow-2xl w-full max-w-lg transform transition-all h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="p-6 border-b">
                    <h2 className="text-2xl font-bold text-[var(--color-text-primary)]">Smart Reminder Settings</h2>
                </div>
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    <div className="p-4 border rounded-lg bg-[var(--color-surface-sunken)]/80">
                        <h3 className="font-bold text-[var(--color-text-primary)] mb-2">Do Not Disturb Windows</h3>
                        <DndSettingsEditor dndWindows={dndWindows} setDndWindows={setDndWindows} onSettingChange={addChangeToHistory} />
                    </div>
                    <div className="p-4 border rounded-lg bg-[var(--color-surface-sunken)]/80 space-y-4">
                        <h3 className="font-bold text-[var(--color-text-primary)]">AI Behavior</h3>
                        <div className="flex justify-between items-center">
                            <label htmlFor="allow-experiments" className="text-sm font-semibold text-[var(--color-text-secondary)]">Allow AI experiments</label>
                            <input type="checkbox" id="allow-experiments" checked={settings.globalAllowExperiments} onChange={e => handleSettingChange('globalAllowExperiments', e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-[var(--color-primary-accent)] focus:ring-[var(--color-primary-accent)]"/>
                        </div>
                        <div className="flex justify-between items-center">
                            <label htmlFor="max-followups" className="text-sm font-semibold text-[var(--color-text-secondary)]">Max follow-up reminders</label>
                            <select id="max-followups" value={settings.maxFollowUps} onChange={e => handleSettingChange('maxFollowUps', parseInt(e.target.value) as 0 | 1)} className="p-1 border rounded-md text-sm">
                                <option value="0">0 (No follow-ups)</option>
                                <option value="1">1</option>
                            </select>
                        </div>
                    </div>
                    <div className="p-4 border rounded-lg bg-[var(--color-surface-sunken)]/80 space-y-3 text-sm">
                        <h3 className="font-bold text-[var(--color-text-primary)]">System Information</h3>
                        <div className="flex justify-between items-center text-[var(--color-text-secondary)]">
                           <span>Stacking guardrail:</span>
                           <span className="font-semibold px-2 py-0.5 bg-green-100 text-green-800 rounded-full text-xs">Always Enabled</span>
                        </div>
                         <div className="flex justify-between items-center text-[var(--color-text-secondary)]">
                           <span>Auto-pause threshold:</span>
                           <span className="font-semibold">{settings.autoPauseThreshold} consecutive ignores</span>
                        </div>
                    </div>
                </div>
                <div className="p-4 border-t bg-[var(--color-surface-sunken)]">
                    <button onClick={onClose} className="w-full px-4 py-2 font-semibold text-[var(--color-text-secondary)] bg-[var(--color-border)] hover:bg-[var(--color-border-hover)] rounded-lg">Close</button>
                </div>
            </div>
        </div>
    );
};

const CalendarPage: React.FC<CalendarPageProps> = ({ 
    scheduleEvents, setScheduleEvents, 
    smartReminders, setSmartReminders, 
    dndWindows, setDndWindows, 
    pauseUntil, setPauseUntil,
    onboardingPreview, setOnboardingPreview
}) => {
    const [changeHistory, setChangeHistory] = useState<ChangeHistoryItem[]>([]);
    const [undoSnackbar, setUndoSnackbar] = useState<UndoSnackbarData | null>(null);
    const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [infoPanelOpenFor, setInfoPanelOpenFor] = useState<string | null>(null);
    const [habitStackSuggestion, setHabitStackSuggestion] = useState<{ anchor: ScheduleEvent; reason: string; habit: MicroHabit } | null>(null);
    const [habitStackError, setHabitStackError] = useState<string | null>(null);
    const [showAssumptionsCard, setShowAssumptionsCard] = useState(false);
    const [isAddAnchorModalOpen, setIsAddAnchorModalOpen] = useState(false);
    const [isAddReminderModalOpen, setIsAddReminderModalOpen] = useState(false);
    const [settings, setSettings] = useState<SettingsData>({
        globalAllowExperiments: true,
        maxFollowUps: 1,
        autoPauseThreshold: 3,
        stackingGuardrailEnabled: true,
    });
    const [highlightedAnchors, setHighlightedAnchors] = useState<string[]>([]);
    const [expandedAnchors, setExpandedAnchors] = useState<string[]>([]);
    const [draggedEventId, setDraggedEventId] = useState<string | null>(null);
    const [dropTargetDay, setDropTargetDay] = useState<ScheduleEvent['day'] | null>(null);
    const [conflict, setConflict] = useState<ConflictType | null>(null);

    useEffect(() => {
        if (scheduleEvents.length === 0 && !onboardingPreview) {
            setIsOnboardingOpen(true);
        }
    }, [scheduleEvents, onboardingPreview]);

    useEffect(() => {
        if (scheduleEvents.length > 0 && !localStorage.getItem('hasSeenAssumptionCard')) {
            const timer = setTimeout(() => {
                setShowAssumptionsCard(true);
                const workAnchorIds = scheduleEvents
                    .filter(e => e.title.toLowerCase().includes('work'))
                    .map(e => e.id);
                setHighlightedAnchors(workAnchorIds);
            }, 5000);
            return () => clearTimeout(timer);
        }
    }, [scheduleEvents]);

    useEffect(() => {
        if (habitStackSuggestion || habitStackError) return;

        const successfulAnchors = scheduleEvents.filter(anchor => {
            const associatedReminders = smartReminders.filter(r => r.eventId === anchor.id);
            if (associatedReminders.length === 0) return false;
            return associatedReminders.every(r => {
                const history = r.successHistory || [];
                if (history.length < 3) return false;
                const successRate = history.filter(s => s === 'success').length / history.length;
                return successRate >= 0.75;
            });
        });

        const eligibleAnchor = successfulAnchors.find(anchor => {
            const hasNewStackedHabit = smartReminders.some(r => 
                r.eventId === anchor.id && r.isStackedHabit && (r.successHistory || []).length < 3
            );
            return !hasNewStackedHabit;
        });

        if (eligibleAnchor) {
            // FIX: Provide a default EnergyTag context for habit suggestions on calendar anchors.
            // Using 'Admin' as a neutral context for suggesting transitional habits.
            const habit = getHabitSuggestion({ completedEnergyTag: EnergyTag.Admin });
            if (habit) {
                 setHabitStackSuggestion({
                    anchor: eligibleAnchor,
                    reason: `You've built a solid routine around "${eligibleAnchor.title}". This is a great time to stack a new habit!`,
                    habit: habit
                });
            }
        }
    }, [smartReminders, scheduleEvents, habitStackSuggestion, habitStackError]);

    const activeReminders = useMemo(() => {
        if (pauseUntil && new Date() < new Date(pauseUntil)) {
            return [];
        }

        let reminders = smartReminders
            .filter(r => r.status === ReminderStatus.Active || r.status === ReminderStatus.Snoozed || r.status === ReminderStatus.Paused)
            .map(r => {
                const event = scheduleEvents.find(e => e.id === r.eventId);
                if (!event) return null;
                
                const now = new Date();
                const [h, m] = event.startTime.split(':').map(Number);
                const eventDate = new Date(now);
                eventDate.setHours(h, m, 0, 0);

                let triggerTime = new Date(eventDate.getTime() + r.offsetMinutes * 60000);
                if ((r.status === ReminderStatus.Snoozed || r.status === ReminderStatus.Paused) && r.snoozedUntil) {
                    triggerTime = new Date(r.snoozedUntil);
                }

                if (triggerTime < now && r.status !== ReminderStatus.Snoozed && r.status !== ReminderStatus.Paused) {
                    return null;
                }

                let shiftedReason: string | null = null;
                const todayDay = DAYS_OF_WEEK[now.getDay() === 0 ? 6 : now.getDay() - 1];
                const dndWindow = dndWindows.find(d => d.day === todayDay);
                
                if (dndWindow && dndWindow.startTime && dndWindow.endTime) {
                    const [sh, sm] = dndWindow.startTime.split(':').map(Number);
                    const [eh, em] = dndWindow.endTime.split(':').map(Number);
                    
                    if (![sh, sm, eh, em].some(isNaN)) {
                        let dndStart = new Date(now);
                        dndStart.setHours(sh, sm, 0, 0);
                        let dndEnd = new Date(now);
                        dndEnd.setHours(eh, em, 0, 0);

                        if (dndEnd < dndStart) {
                            if (now < dndEnd) dndStart.setDate(dndStart.getDate() - 1);
                            else dndEnd.setDate(dndEnd.getDate() + 1);
                        }
                        
                        if (triggerTime >= dndStart && triggerTime <= dndEnd) {
                            triggerTime = new Date(dndEnd.getTime());
                            shiftedReason = "DND-shifted";
                        }
                    }
                }
                
                return { ...r, event, triggerTime, shiftedReason };
            })
            .filter((r): r is NonNullable<typeof r> => r !== null)
            .sort((a, b) => a.triggerTime.getTime() - b.triggerTime.getTime());

        return reminders;
    }, [smartReminders, scheduleEvents, dndWindows, pauseUntil]);

    const addChangeToHistory = (message: string, undoCallback: () => void) => {
        const newHistoryEntry: ChangeHistoryItem = { id: Date.now(), message, undo: undoCallback };
        setChangeHistory(prev => [newHistoryEntry, ...prev].slice(0, 5));
        setUndoSnackbar({ message, onUndo: undoCallback });
        setTimeout(() => setUndoSnackbar(null), 6000);
    };

    const moveEvent = (eventId: string, targetDay: ScheduleEvent['day'], newStartTime?: string) => {
        const originalEvents = [...scheduleEvents];
        const eventToMove = originalEvents.find(e => e.id === eventId);
        if (!eventToMove) return;

        const startTime = newStartTime || eventToMove.startTime;
        const duration = timeToMinutes(eventToMove.endTime) - timeToMinutes(eventToMove.startTime);
        const endTime = minutesToTime(timeToMinutes(startTime) + duration);

        setScheduleEvents(prev => prev.map(e => {
            if (e.id === eventId) {
                return { ...e, day: targetDay, startTime, endTime };
            }
            return e;
        }));
        
        const timeStr = `${formatTimeForToast(startTime)}–${formatTimeForToast(endTime)}`;
        addChangeToHistory(`Moved "${eventToMove.title}" to ${targetDay}, ${timeStr}.`, () => setScheduleEvents(originalEvents));
    };

    const handleDragStart = (e: React.DragEvent<HTMLDivElement>, eventId: string) => {
        e.dataTransfer.setData('application/json', JSON.stringify({ eventId }));
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => setDraggedEventId(eventId), 0);
    };

    const handleDragEnd = () => {
        setDraggedEventId(null);
        setDropTargetDay(null);
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>, day: ScheduleEvent['day']) => {
        e.preventDefault();
        setDropTargetDay(null);
        setDraggedEventId(null);

        const { eventId } = JSON.parse(e.dataTransfer.getData('application/json'));
        const eventToMove = scheduleEvents.find(ev => ev.id === eventId);
        if (!eventToMove || eventToMove.day === day) return;
        
        const dnd = dndWindows.find(w => w.day === day);
        if (dnd && doTimesOverlap(eventToMove.startTime, eventToMove.endTime, dnd.startTime, dnd.endTime)) {
            setConflict({ type: 'dnd', eventToMoveId: eventId, targetDay: day });
            return;
        }
        
        const overlappingEvent = scheduleEvents.find(ev => ev.day === day && ev.id !== eventId && doTimesOverlap(eventToMove.startTime, eventToMove.endTime, ev.startTime, ev.endTime));
        if (overlappingEvent) {
            setConflict({ type: 'overlap', eventToMoveId: eventId, targetDay: day, overlappingEventId: overlappingEvent.id });
            return;
        }
        moveEvent(eventId, day);
    };

    const resolveConflict = (decision: 'shift_dnd' | 'shift_overlap' | 'keep_overlap') => {
        if (!conflict) return;
        const { eventToMoveId, targetDay } = conflict;

        if (decision === 'keep_overlap') {
            moveEvent(eventToMoveId, targetDay);
        } else if (decision === 'shift_overlap') {
            const overlappingEvent = scheduleEvents.find(e => e.id === conflict.overlappingEventId);
            if (overlappingEvent) {
                const newStartTime = minutesToTime(timeToMinutes(overlappingEvent.endTime));
                moveEvent(eventToMoveId, targetDay, newStartTime);
            }
        } else if (decision === 'shift_dnd') {
            const dnd = dndWindows.find(w => w.day === targetDay);
            if (dnd) {
                const newStartTime = dnd.endTime;
                moveEvent(eventToMoveId, targetDay, newStartTime);
            }
        }
        setConflict(null);
    }
    
    const handleDuplicateAnchor = (eventId: string) => {
        const originalEvent = scheduleEvents.find(e => e.id === eventId);
        if (!originalEvent) return;
        const newEvent: ScheduleEvent = {
            ...originalEvent,
            id: `copy-${originalEvent.id}-${Date.now()}`,
        };
        const originalEvents = [...scheduleEvents];
        setScheduleEvents(prev => [...prev, newEvent]);
        addChangeToHistory(`Duplicated "${originalEvent.title}".`, () => setScheduleEvents(originalEvents));
    };

    const handleSaveAnchor = (data: { title: string; startTime: string; endTime: string; days: ScheduleEvent['day'][] }) => {
        const originalEvents = [...scheduleEvents];
        const newEvents: ScheduleEvent[] = data.days.map(day => ({
            id: `manual-${data.title.replace(/\s+/g, '-')}-${day}-${Date.now()}`,
            day: day,
            title: data.title,
            startTime: data.startTime,
            endTime: data.endTime,
            contextTags: [ContextTag.Personal]
        }));
        setScheduleEvents(prev => [...prev, ...newEvents]);
        
        const dayStr = formatDaysForToast(data.days);
        const startTimeStr = formatTimeForToast(data.startTime);
        const endTimeStr = formatTimeForToast(data.endTime);
        const message = `${data.title} anchor added for ${dayStr}, ${startTimeStr}–${endTimeStr}.`;

        addChangeToHistory(message, () => setScheduleEvents(originalEvents));
        setIsAddAnchorModalOpen(false);
    };

    const handleCreateReminderFromModal = (newReminders: SmartReminder[]) => {
        const originalReminders = [...smartReminders];
        setSmartReminders(prev => [...prev, ...newReminders]);
        const { message, offsetMinutes, eventId } = newReminders[0];
        const anchor = scheduleEvents.find(e => e.id === eventId);
        const offsetStr = formatOffsetForToast(offsetMinutes);
        const historyMessage = `Reminder added: ${message} ${offsetStr} ${anchor?.title}.`;
        addChangeToHistory(historyMessage, () => setSmartReminders(originalReminders));
        setIsAddReminderModalOpen(false);
    };

    const handleReminderAction = (id: string, action: 'done' | 'snooze' | 'ignore' | 'later' | 'revert_exploration' | 'pause' | 'toggle_lock', payload?: any) => {
        const originalReminders = [...smartReminders];
        const reminderToUpdate = originalReminders.find(r => r.id === id);
        if (!reminderToUpdate) return;
        
        let updatedReminders = smartReminders;
        let historyMessage = '';

        if (action === 'snooze') {
            const snoozeMinutes = payload as number;
            updatedReminders = smartReminders.map(r => r.id === id ? {
                ...r,
                status: ReminderStatus.Snoozed,
                snoozedUntil: new Date(Date.now() + snoozeMinutes * 60000).toISOString(),
                snoozeHistory: [...(r.snoozeHistory || []), snoozeMinutes],
                successHistory: [...(r.successHistory || []), 'snoozed'],
                lastInteraction: new Date().toISOString(),
            } : r);
            historyMessage = `Snoozed "${reminderToUpdate.message}" for ${snoozeMinutes}m.`;
        } else if (action === 'done') {
            updatedReminders = smartReminders.map(r => r.id === id ? {
                ...r, status: ReminderStatus.Done, successHistory: [...(r.successHistory || []), 'success'], lastInteraction: new Date().toISOString() 
            } : r);
            historyMessage = `Completed "${reminderToUpdate.message}".`;
            if (reminderToUpdate.isStackedHabit && reminderToUpdate.habitId) {
                const { newStreak } = recordHabitCompletion(reminderToUpdate.habitId);
                historyMessage += ` 🔥 Streak: ${newStreak}!`;
            }
        } else if (action === 'pause') {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(9, 0, 0, 0);
            updatedReminders = smartReminders.map(r => r.id === id ? {
                ...r,
                status: ReminderStatus.Paused,
                snoozedUntil: tomorrow.toISOString(),
            } : r);
            historyMessage = `Paused "${reminderToUpdate.message}" until tomorrow.`;
        } else if (action === 'toggle_lock') {
            const isNowLocked = !reminderToUpdate.isLocked;
            updatedReminders = smartReminders.map(r => r.id === id ? { ...r, isLocked: isNowLocked, allowExploration: !isNowLocked } : r);
            historyMessage = `${isNowLocked ? 'Locked' : 'Unlocked'} "${reminderToUpdate.message}".`;
        } else if (action === 'ignore') {
            updatedReminders = smartReminders.map(r => r.id === id ? {
                ...r, status: ReminderStatus.Ignored, successHistory: [...(r.successHistory || []), 'ignored'], lastInteraction: new Date().toISOString() 
            } : r);
        } else if (action === 'later') {
            const now = new Date();
            let laterTime = new Date(now.getTime() + 3 * 60 * 60 * 1000);

            const todayDay = DAYS_OF_WEEK[now.getDay() === 0 ? 6 : now.getDay() - 1];
            const dndWindow = dndWindows.find(d => d.day === todayDay);
            if (dndWindow && dndWindow.startTime) {
                const [h, m] = dndWindow.startTime.split(':').map(Number);
                if (!isNaN(h) && !isNaN(m)) {
                    let dndStart = new Date();
                    dndStart.setHours(h, m, 0, 0);
                    if (dndStart < now) dndStart.setDate(dndStart.getDate() + 1);
                    const dndCap = new Date(dndStart.getTime() - 15 * 60000);
                    if (laterTime > dndCap) laterTime = dndCap;
                }
            }
            if (laterTime <= now) laterTime = new Date(now.getTime() + 60 * 60 * 1000);

            updatedReminders = smartReminders.map(r => r.id === id ? {
                ...r,
                status: ReminderStatus.Snoozed,
                snoozedUntil: laterTime.toISOString(),
                successHistory: [...(r.successHistory || []), 'snoozed'],
                lastInteraction: new Date().toISOString(),
            } : r);
            historyMessage = `Rescheduled "${reminderToUpdate.message}" for later.`;
        } else if (action === 'revert_exploration') {
             updatedReminders = smartReminders.map(r => {
                if (r.id === id && r.isExploratory && r.originalOffsetMinutes !== undefined) {
                    const { originalOffsetMinutes, ...rest } = r;
                    return {
                        ...rest,
                        offsetMinutes: originalOffsetMinutes,
                        isExploratory: false,
                        status: ReminderStatus.Active,
                        snoozedUntil: null,
                    };
                }
                return r;
            });
            historyMessage = `Reverted experiment for "${reminderToUpdate.message}".`;
        }

        setSmartReminders(updatedReminders);
        if (historyMessage) {
            addChangeToHistory(historyMessage, () => setSmartReminders(originalReminders));
        }
    };
    
    const handleAcceptHabitStack = (anchorId: string, habit: MicroHabit) => {
        const originalReminders = [...smartReminders];
        const anchor = scheduleEvents.find(e => e.id === anchorId);
        if (!anchor) return;

        const hasNewStackedHabit = smartReminders.some(r => r.eventId === anchorId && r.isStackedHabit && (r.successHistory || []).length < 3);
        if (hasNewStackedHabit) {
            setHabitStackError(`This anchor is full for now—let's give the new habit time to stick!`);
            setTimeout(() => setHabitStackError(null), 5000);
            setHabitStackSuggestion(null);
            return;
        }

        const newReminder: SmartReminder = {
            id: `sr-stack-${Date.now()}`,
            eventId: anchorId,
            offsetMinutes: 5,
            message: habit.name,
            habitId: habit.id,
            why: `Stacking a new habit onto your successful "${anchor.title}" routine.`,
            isLocked: false,
            isExploratory: false,
            status: ReminderStatus.Active,
            snoozeHistory: [],
            snoozedUntil: null,
            successHistory: [],
            isStackedHabit: true,
            allowExploration: true,
        };
        setSmartReminders(prev => [...prev, newReminder]);
        addChangeToHistory(`Added new habit: "${habit.name}"`, () => setSmartReminders(originalReminders));
        setHabitStackSuggestion(null);
    };
    
    const toggleAnchorExpansion = (id: string) => {
        setExpandedAnchors(prev =>
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    const handleDismissAssumptionCard = () => {
        setShowAssumptionsCard(false);
        setHighlightedAnchors([]);
        localStorage.setItem('hasSeenAssumptionCard', 'true');
    };

    const handleNewHabitSuggestion = () => {
        if (!habitStackSuggestion) return;
        // FIX: Provide a default EnergyTag context for suggesting another habit.
        // Using 'Admin' as a neutral context for suggesting transitional habits.
        const newHabit = getHabitSuggestion({ completedEnergyTag: EnergyTag.Admin });
        if (newHabit) {
            setHabitStackSuggestion(prev => prev ? { ...prev, habit: newHabit } : null);
        }
    };

    const HabitStackSuggestionCard: React.FC<{
        suggestion: { anchor: ScheduleEvent; reason: string; habit: MicroHabit };
        onAccept: (anchorId: string, habit: MicroHabit) => void;
        onDecline: () => void;
        onNewSuggestion: () => void;
    }> = ({ suggestion, onAccept, onDecline, onNewSuggestion }) => {
        return (
            <div className="bg-[var(--color-surface)] p-4 rounded-xl shadow-lg border border-[var(--color-border)] animate-fade-in mt-8">
                <h3 className="font-bold text-[var(--color-text-primary)]">Ready for a new habit?</h3>
                <p className="text-sm text-[var(--color-text-secondary)] mt-1">{suggestion.reason}</p>
                 <div className="bg-[var(--color-surface-sunken)] p-3 rounded-lg my-3 border text-left">
                    <p className="font-bold text-[var(--color-text-primary)]">{suggestion.habit.name}</p>
                    <p className="text-sm text-[var(--color-text-secondary)] mt-1">{suggestion.habit.description}</p>
                </div>
                <div className="flex justify-end gap-2 mt-3">
                    <button onClick={onDecline} className="px-3 py-1 text-sm font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-sunken)] rounded-md">No Thanks</button>
                    <button onClick={onNewSuggestion} className="px-3 py-1 text-sm font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-sunken)] rounded-md">Another idea</button>
                    <button onClick={() => onAccept(suggestion.anchor.id, suggestion.habit)} className="px-3 py-1 text-sm font-semibold text-[var(--color-primary-accent-text)] bg-[var(--color-primary-accent)] rounded-md disabled:bg-stone-400">Yes, Add It</button>
                </div>
            </div>
        );
    };

    const ReminderInfoPanel: React.FC<{ reminder: (typeof activeReminders)[0] }> = ({ reminder }) => (
        <div className="mt-3 p-3 bg-[var(--color-surface-sunken)] rounded-lg border border-[var(--color-border)] text-sm animate-fade-in">
            <h4 className="font-bold text-[var(--color-text-primary)] mb-2">Details</h4>
            <div className="space-y-1.5 text-[var(--color-text-secondary)]">
                <p><strong>Linked Anchor:</strong> {reminder.event.title} ({reminder.event.startTime})</p>
                <div className="flex items-center gap-2">
                    <strong>Recent History:</strong>
                    <div className="flex gap-1">
                        {reminder.successHistory.slice(-10).map((s, i) => (
                            <span key={i} title={s} className={`h-3 w-3 rounded-full ${s === 'success' ? 'bg-green-500' : s === 'snoozed' ? 'bg-yellow-500' : 'bg-red-500'}`}></span>
                        ))}
                        {reminder.successHistory.length === 0 && <span className="text-xs italic">No history yet.</span>}
                    </div>
                </div>
                <p><strong>Constraints:</strong> {reminder.isLocked ? "Locked by user." : "Flexible timing allowed."} DND is active {dndWindows.find(d => d.day === reminder.event.day)?.startTime} - {dndWindows.find(d => d.day === reminder.event.day)?.endTime}.</p>
                <p><strong>Reasoning:</strong> {reminder.why}</p>
            </div>
        </div>
    );
    
    const ReminderCard: React.FC<{ reminder: (typeof activeReminders)[0] }> = ({ reminder }) => {
        const [showSnoozeOptions, setShowSnoozeOptions] = useState(false);
        const { triggerTime, shiftedReason } = reminder;

        return (
            <div className="bg-[var(--color-surface)] p-4 rounded-xl shadow-md border border-[var(--color-border)]/80 relative transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5">
                <div className="flex items-start gap-2 mb-2 flex-wrap">
                    {shiftedReason && <span className="text-xs font-semibold bg-orange-100 text-orange-800 px-2 py-0.5 rounded-full">{shiftedReason}</span>}
                    {reminder.isLocked && <span className="text-xs font-semibold bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded-full flex items-center gap-1"><LockIcon className="h-3 w-3"/> Locked</span>}
                    {reminder.isExploratory && <span className="text-xs font-semibold bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full">Experiment</span>}
                </div>
                
                <div className="flex items-start gap-3">
                    <div className="mt-1">
                        <p className="font-bold text-[var(--color-text-primary)] text-lg">{reminder.message}</p>
                        <p className="text-sm text-[var(--color-text-secondary)] font-medium">
                           {`Today at ${triggerTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}
                        </p>
                        <p className="text-sm mt-1 text-[var(--color-text-secondary)] italic">"{reminder.why}"</p>
                    </div>
                    <button onClick={() => setInfoPanelOpenFor(prev => prev === reminder.id ? null : reminder.id)} className="ml-auto flex-shrink-0 p-1 text-[var(--color-text-subtle)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-sunken)] rounded-full">
                        <InfoIcon className="h-5 w-5"/>
                    </button>
                </div>

                {infoPanelOpenFor === reminder.id && <ReminderInfoPanel reminder={reminder} />}

                <div className="mt-4 pt-4 border-t flex justify-end items-center gap-2 relative">
                    {showSnoozeOptions && (
                         <div className="absolute right-0 bottom-full mb-2 flex gap-2 bg-[var(--color-surface)] p-2 rounded-lg shadow-xl border z-10">
                            {[5, 10, 15].map(min => <button key={min} onClick={() => { handleReminderAction(reminder.id, 'snooze', min); setShowSnoozeOptions(false); }} className="px-3 py-1 text-sm font-semibold rounded-md bg-[var(--color-surface-sunken)] hover:bg-[var(--color-border)]">{min}m</button>)}
                             <button onClick={() => { const custom = prompt("Snooze for how many minutes?"); if(custom && !isNaN(parseInt(custom))) { handleReminderAction(reminder.id, 'snooze', parseInt(custom)); setShowSnoozeOptions(false); } }} className="px-3 py-1 text-sm font-semibold rounded-md bg-[var(--color-surface-sunken)] hover:bg-[var(--color-border)]">Custom</button>
                        </div>
                    )}
                    <button onClick={() => handleReminderAction(reminder.id, 'toggle_lock')} title={reminder.isLocked ? "Unlock Reminder" : "Lock Reminder"} className="p-2 text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-sunken)] rounded-lg">
                        {reminder.isLocked ? <LockIcon className="h-5 w-5"/> : <LockOpenIcon className="h-5 w-5"/>}
                    </button>
                     <button onClick={() => handleReminderAction(reminder.id, 'pause')} title="Pause until tomorrow" className="p-2 text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-sunken)] rounded-lg">
                        <PauseIcon className="h-5 w-5"/>
                    </button>
                    <div className="flex-grow"></div>
                    <button onClick={() => handleReminderAction(reminder.id, 'later')} className="px-3 py-1.5 text-sm font-semibold text-[var(--color-text-secondary)] bg-[var(--color-surface-sunken)] hover:bg-[var(--color-border)] rounded-lg">Later Today</button>
                    <button onClick={() => setShowSnoozeOptions(p => !p)} className="px-3 py-1.5 text-sm font-semibold text-[var(--color-text-secondary)] bg-[var(--color-surface-sunken)] hover:bg-[var(--color-border)] rounded-lg">Snooze</button>
                    <button onClick={() => handleReminderAction(reminder.id, 'done')} className="px-3 py-1.5 text-sm font-semibold text-[var(--color-primary-accent-text)] bg-[var(--color-primary-accent)] hover:bg-[var(--color-primary-accent-hover)] rounded-lg">Done</button>
                </div>
            </div>
        )
    };
    
    return (
        <main className="container mx-auto p-8 relative">
            <style>
                {`@keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.6; }
                }
                .animate-highlight { animation: pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) 2; }`}
            </style>
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-4xl font-bold text-[var(--color-text-primary)]">Smart Reminder System</h1>
                    <p className="text-[var(--color-text-secondary)] mt-1">Your executive-function copilot for a smoother day.</p>
                </div>
                <div className="flex items-center gap-2">
                    <button 
                      id="setup-button"
                      onClick={() => setIsOnboardingOpen(true)}
                      className="px-4 py-2 font-semibold text-[var(--color-primary-accent-text)] bg-[var(--color-primary-accent)] rounded-lg hover:bg-[var(--color-primary-accent-hover)] transition-all shadow-sm flex items-center gap-2"
                    >
                      <WandIcon className="h-5 w-5" />
                      <span>Set Up My Routine</span>
                    </button>
                    <button
                      id="settings-button"
                      onClick={() => setIsSettingsOpen(true)}
                      className="p-2.5 font-semibold text-[var(--color-text-secondary)] bg-[var(--color-surface)] border border-[var(--color-border)] hover:bg-[var(--color-surface-sunken)] rounded-lg transition-all shadow-sm"
                      title="Settings"
                    >
                        <GearIcon className="h-5 w-5" />
                    </button>
                </div>
            </div>

            {pauseUntil && new Date() < new Date(pauseUntil) && (
                <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-800 p-4 rounded-r-lg mb-6 flex justify-between items-center shadow-sm">
                    <p><span className="font-bold">Reminders Paused.</span> Things will resume on {new Date(pauseUntil).toLocaleDateString()}.</p>
                    <button onClick={() => {
                        const originalPause = pauseUntil;
                        setPauseUntil(null);
                        addChangeToHistory('Reminders resumed.', () => setPauseUntil(originalPause));
                    }} className="font-semibold underline">Resume Now</button>
                </div>
            )}
            
            <div className="space-y-8">
                <div>
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-2xl font-bold text-[var(--color-text-primary)]">Upcoming Reminders</h2>
                         <button 
                            onClick={() => setIsAddReminderModalOpen(true)}
                            className="flex items-center space-x-2 px-4 py-2 text-sm font-semibold text-[var(--color-primary-accent-text)] bg-[var(--color-primary-accent)] hover:bg-[var(--color-primary-accent-hover)] rounded-lg transition-all duration-300 shadow-sm">
                            <PlusIcon className="h-4 w-4" />
                            <span>Add Reminder</span>
                        </button>
                    </div>

                    <div className="space-y-4">
                       {activeReminders.length > 0 ? activeReminders.slice(0, 5).map(r => <ReminderCard key={r.id} reminder={r} />) : 
                        <div className="text-center py-12 bg-[var(--color-surface-sunken)] rounded-xl border-2 border-dashed">
                            <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
                                {scheduleEvents.length === 0 ? "Let's set up your routine!" : pauseUntil ? "Reminders are paused" : "All clear for now!"}
                            </h3>
                            <p className="text-[var(--color-text-secondary)] mt-1">{scheduleEvents.length === 0 ? "Click 'Set Up My Routine' to get started." : pauseUntil ? "Enjoy the quiet." : "No upcoming reminders on your schedule."}</p>
                        </div>
                       }
                       {activeReminders.length > 5 && (
                            <button className="w-full text-center p-3 font-semibold text-[var(--color-text-secondary)] bg-[var(--color-surface-sunken)] hover:bg-[var(--color-border)] rounded-lg transition-colors">
                                See More on Weekly Map
                            </button>
                       )}
                    </div>
                     {habitStackSuggestion && (
                        <HabitStackSuggestionCard 
                            suggestion={habitStackSuggestion}
                            onAccept={handleAcceptHabitStack}
                            onDecline={() => setHabitStackSuggestion(null)}
                            onNewSuggestion={handleNewHabitSuggestion}
                        />
                    )}
                    {habitStackError && <div className="mt-4 p-3 bg-yellow-100 text-yellow-800 rounded-lg text-sm font-semibold">{habitStackError}</div>}
                </div>
                {showAssumptionsCard && (
                    <div className="bg-blue-50 p-4 rounded-xl shadow-lg border border-blue-200 animate-fade-in">
                        <h3 className="font-bold text-blue-800">I’ll suggest harder tasks when you have the most energy. Does this look right for your 'Work' blocks?</h3>
                        <div className="flex justify-end gap-2 mt-3">
                            <button onClick={handleDismissAssumptionCard} className="px-3 py-1 text-sm font-semibold text-blue-800 hover:bg-blue-100 rounded-md">Not Now</button>
                            <button onClick={() => { console.log('Correct assumption confirmed!'); handleDismissAssumptionCard(); }} className="px-3 py-1 text-sm font-semibold text-blue-800 hover:bg-blue-100 rounded-md">Looks Good!</button>
                        </div>
                    </div>
                )}
                <div>
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-2xl font-bold text-[var(--color-text-primary)] flex items-center gap-2"><CalendarIcon className="h-6 w-6" /> Your Anchor Map</h2>
                         <button 
                            onClick={() => setIsAddAnchorModalOpen(true)}
                            className="flex items-center space-x-2 px-3 py-1 text-sm font-semibold text-[var(--color-text-secondary)] bg-[var(--color-surface-sunken)] hover:bg-[var(--color-border)] rounded-lg transition-all duration-300 border border-[var(--color-border-hover)] shadow-sm">
                            <PlusIcon className="h-4 w-4" />
                            <span>Add Anchor</span>
                        </button>
                    </div>
                    {scheduleEvents.length > 0 ? (
                        <div className="bg-[var(--color-surface)] p-4 rounded-2xl shadow-lg border border-[var(--color-border)]">
                             <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-7 gap-2">
                                {DAYS_OF_WEEK.map(day => (
                                    <div 
                                        key={day} 
                                        className={`bg-[var(--color-surface-sunken)]/70 p-2 rounded-lg border min-h-[200px] transition-colors ${dropTargetDay === day ? 'bg-[var(--color-border)]' : ''}`}
                                        onDragOver={(e) => e.preventDefault()}
                                        onDragEnter={(e) => { e.preventDefault(); setDropTargetDay(day); }}
                                        onDragLeave={() => setDropTargetDay(null)}
                                        onDrop={(e) => handleDrop(e, day)}
                                    >
                                        <h3 className="font-bold text-center text-sm text-[var(--color-text-secondary)] mb-2">{day.slice(0,3)}</h3>
                                        <div className="space-y-1.5">
                                            {scheduleEvents.filter(e => e.day === day).sort((a,b) => a.startTime.localeCompare(b.startTime)).map(event => {
                                                const isExpanded = expandedAnchors.includes(event.id);
                                                const isHighlighted = highlightedAnchors.includes(event.id);
                                                return (
                                                    <div 
                                                        key={event.id}
                                                        draggable
                                                        onDragStart={(e) => handleDragStart(e, event.id)}
                                                        onDragEnd={handleDragEnd}
                                                        className={`p-2 rounded-md shadow-sm border group text-xs cursor-pointer transition-all duration-200 relative ${getAnchorColor(event.title)} ${isHighlighted ? 'animate-highlight ring-2 ring-blue-500 ring-offset-2' : ''} ${draggedEventId === event.id ? 'opacity-30' : ''}`}
                                                    >
                                                        <div onClick={() => toggleAnchorExpansion(event.id)}>
                                                            <p className="font-semibold truncate">{event.title}</p>
                                                            {isExpanded && (
                                                                <p className="truncate animate-fade-in">{event.startTime} - {event.endTime}</p>
                                                            )}
                                                        </div>
                                                         <button 
                                                            onClick={() => handleDuplicateAnchor(event.id)}
                                                            className="absolute top-0 right-0 p-0.5 rounded-full bg-white/30 text-white opacity-0 group-hover:opacity-100 hover:bg-white/50 transition-opacity"
                                                            title="Duplicate Anchor"
                                                        >
                                                            <DuplicateIcon className="h-4 w-4" />
                                                        </button>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-12 bg-[var(--color-surface-sunken)] rounded-xl border-2 border-dashed">
                            <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">No Anchors Set</h3>
                            <p className="text-[var(--color-text-secondary)] mt-1">Your weekly schedule is empty. Use the setup button to add your core events.</p>
                        </div>
                    )}
                </div>
            </div>
            
            <AiChat
                scheduleEvents={scheduleEvents}
                setScheduleEvents={setScheduleEvents}
                smartReminders={smartReminders}
                setSmartReminders={setSmartReminders}
                pauseUntil={pauseUntil}
                setPauseUntil={setPauseUntil}
                addChangeToHistory={addChangeToHistory}
            />

            <OnboardingFlow 
                isOpen={isOnboardingOpen}
                onClose={() => setIsOnboardingOpen(false)}
                onComplete={({ newAnchors, newDnd }) => {
                    setScheduleEvents(newAnchors);
                    setDndWindows(newDnd);
                    setIsOnboardingOpen(false);
                }}
                onboardingPreview={onboardingPreview}
                setOnboardingPreview={setOnboardingPreview}
            />
            
            <SettingsPanel
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
                settings={settings}
                setSettings={setSettings}
                dndWindows={dndWindows}
                setDndWindows={setDndWindows}
                addChangeToHistory={addChangeToHistory}
            />

            <AddAnchorModal
                isOpen={isAddAnchorModalOpen}
                onClose={() => setIsAddAnchorModalOpen(false)}
                onSave={handleSaveAnchor}
            />
            
            <AddReminderModal
                isOpen={isAddReminderModalOpen}
                onClose={() => setIsAddReminderModalOpen(false)}
                onSubmit={async (text) => {
                     const parsed = await parseNaturalLanguageReminder(text, scheduleEvents);
                      const targetAnchors = scheduleEvents.filter(e => e.title === parsed.anchorTitle);
                      if (targetAnchors.length === 0) {
                          throw new Error(`Could not find an anchor named "${parsed.anchorTitle}". Please check the name.`);
                      }
                      const newReminders = targetAnchors.map(anchor => ({
                          id: `manual-sr-${anchor.id}-${Date.now()}`,
                          eventId: anchor.id,
                          offsetMinutes: parsed.offsetMinutes,
                          message: parsed.message,
                          why: parsed.why,
                          isLocked: false, isExploratory: false, status: ReminderStatus.Active,
                          snoozeHistory: [], snoozedUntil: null, successHistory: [], allowExploration: true,
                      }));
                      handleCreateReminderFromModal(newReminders);
                }}
            />
            {conflict && (
                <div className="fixed inset-0 bg-black/60 z-[70] flex items-center justify-center p-4" onClick={() => setConflict(null)}>
                    <div className="bg-[var(--color-surface)] rounded-2xl shadow-xl p-6 w-full max-w-sm text-center" onClick={e => e.stopPropagation()}>
                        <h3 className="text-lg font-bold text-[var(--color-text-primary)]">
                            {conflict.type === 'dnd' ? 'Do Not Disturb Conflict' : 'Scheduling Conflict'}
                        </h3>
                        <p className="text-[var(--color-text-secondary)] my-3">
                            {conflict.type === 'dnd' 
                                ? "This anchor falls within your Do Not Disturb hours. Shift to the nearest available time?" 
                                : `This anchor overlaps with "${scheduleEvents.find(e=>e.id === conflict.overlappingEventId)?.title}". What would you like to do?`
                            }
                        </p>
                        <div className="flex flex-col gap-2">
                            {conflict.type === 'dnd' ? (
                                <>
                                    <button onClick={() => resolveConflict('shift_dnd')} className="px-4 py-2 font-semibold text-[var(--color-primary-accent-text)] bg-[var(--color-primary-accent)] rounded-lg">Yes, Shift</button>
                                    <button onClick={() => setConflict(null)} className="px-4 py-2 font-semibold text-[var(--color-text-secondary)] bg-[var(--color-surface-sunken)] hover:bg-[var(--color-border)] rounded-lg">Cancel</button>
                                </>
                            ) : (
                                <>
                                    <button onClick={() => resolveConflict('shift_overlap')} className="px-4 py-2 font-semibold text-[var(--color-primary-accent-text)] bg-[var(--color-primary-accent)] rounded-lg">Shift to Avoid</button>
                                    <button onClick={() => resolveConflict('keep_overlap')} className="px-4 py-2 font-semibold text-[var(--color-text-secondary)] bg-[var(--color-surface-sunken)] hover:bg-[var(--color-border)] rounded-lg">Keep Overlap</button>
                                    <button onClick={() => setConflict(null)} className="px-4 py-2 font-semibold text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-sunken)] rounded-lg">Cancel</button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
};

export default CalendarPage;