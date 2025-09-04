import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import BrainDump from './components/BrainDump';
import BrainDumpModal from './components/BrainDumpModal';
import MomentumMap from './components/MomentumMap';
import TaskPage from './components/TaskPage';
import CalendarPage from './components/CalendarPage';
import { GoogleGenAI, Type } from "@google/genai";
import { BrainDumpItem, Note, SavedTask, MomentumMapData, EnergyTag, ScheduleEvent, SmartReminder, ContextTag, ReminderStatus, DNDWindow, TimeLearningSettings, CompletionRecord, ThemeSettings, ThemeName, CustomThemeProperties } from './types';
import { getCompletionHistory, addRecordToHistory } from './utils/timeAnalytics';
import TimeLearningSettingsPage from './components/TimeLearningSettings';
import { themes, themePresets } from './utils/styles';
import { determineOptimalTheme } from './utils/themeEngine';
import ThemeSettingsModal from './components/ThemeSettingsModal';
import ThemeSuggestionToast from './components/ThemeSuggestionToast';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const processWithGemini = async (text: string): Promise<BrainDumpItem[]> => {
    const schema = {
        type: Type.ARRAY,
        items: {
            type: Type.OBJECT,
            properties: {
                id: { type: Type.STRING, description: 'A unique identifier for the item (e.g., timestamp and index).' },
                item: { type: Type.STRING, description: 'The original text of the single, distinct thought or task.' },
                tags: { 
                    type: Type.ARRAY, 
                    description: 'An array of relevant tags or categories (e.g., "Work", "Marketing", "Urgent", "Idea").',
                    items: { type: Type.STRING } 
                },
                isUrgent: { type: Type.BOOLEAN, description: 'True if the item contains language indicating urgency (e.g., "by Thursday", "ASAP").' },
            },
            required: ['id', 'item', 'tags', 'isUrgent'],
        },
    };

    const prompt = `
      Analyze the following text, which is a "brain dump" of thoughts.
      Split the text into individual, distinct items.
      For each item, perform the following actions:
      1.  **Extract Tags**: Assign a list of relevant tags (e.g., "Work", "Personal", "Ideas", "Marketing Campaign", "Q2 Budget"). Combine high-level categories and specific projects into a single list of tags. If the item is urgent, also include an "Urgent" tag.
      2.  **Detect Urgency**: Separately determine if the item is time-sensitive based on keywords (e.g., "by EOD", "tomorrow", "needs to be done"). Set isUrgent to true if so.
      3.  **Generate ID**: Create a unique ID for each item using the current timestamp in milliseconds combined with its index.
      Return the output as a JSON object that strictly follows this schema.

      Input Text:
      "${text}"
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
        return Array.isArray(result) ? result : [];

    } catch (error) {
        console.error("Error processing with Gemini:", error);
        throw new Error("Failed to process thoughts. The AI model might be busy. Please try again.");
    }
};

const mockBrainDumpItems: BrainDumpItem[] = [
  {
    id: 'bd-mock-1',
    item: 'Draft Q3 marketing strategy document',
    tags: ['Work', 'Marketing', 'Q3 Planning', 'Urgent'],
    isUrgent: true,
    timeEstimateMinutesP50: 90,
    timeEstimateMinutesP90: 120,
    blockers: ['Awaiting final budget numbers'],
  },
  {
    id: 'bd-mock-2',
    item: 'Book dentist appointment for next month',
    tags: ['Personal', 'Health'],
    isUrgent: false,
    timeEstimateMinutesP50: 5,
    timeEstimateMinutesP90: 10,
    blockers: [],
  },
];

const mockSavedTasks: SavedTask[] = [
  {
    id: 'map-mock-1',
    nickname: 'Launch New Feature',
    note: 'Paused this to work on a critical bug fix. Ready to resume with user testing chunk.',
    savedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    mapData: {
      finishLine: {
        statement: 'Successfully launch the new "AI Insights" feature to all users',
        acceptanceCriteria: [
          'Feature is live and accessible to 100% of the user base.',
          'No critical bugs reported within the first 72 hours.',
          'Positive feedback received from at least 10 users.',
        ],
      },
      chunks: [
        {
          id: 'chunk-mock-1-1', title: 'Finalize UI/UX Design',
          subSteps: [
            { id: 'ss-mock-1-1-1', description: 'Incorporate feedback from stakeholder review', isComplete: true },
            { id: 'ss-mock-1-1-2', description: 'Create final high-fidelity mockups in Figma', isComplete: true },
            { id: 'ss-mock-1-1-3', description: 'Prepare design assets for development handoff', isComplete: true },
          ],
          p50: 60, p90: 90, energyTag: EnergyTag.Creative, blockers: [], isComplete: true,
        },
        {
          id: 'chunk-mock-1-2', title: 'Frontend Development',
          subSteps: [
            { id: 'ss-mock-1-2-1', description: 'Set up component structure', isComplete: true },
            { id: 'ss-mock-1-2-2', description: 'Implement UI based on Figma designs', isComplete: true },
            { id: 'ss-mock-1-2-3', description: 'Integrate with backend API endpoints', isComplete: false },
            { id: 'ss-mock-1-2-4', description: 'Write unit tests for key components', isComplete: false },
          ],
          p50: 120, p90: 180, energyTag: EnergyTag.Tedious, blockers: ['Waiting on final API schema'], isComplete: false,
        },
      ],
    },
    progress: { completedChunks: 1, totalChunks: 2, completedSubSteps: 5, totalSubSteps: 7 },
  },
];

const mockScheduleEvents: ScheduleEvent[] = [
  { id: 'se-1', day: 'Monday', title: 'Morning Commute', startTime: '08:00', endTime: '08:45', contextTags: [ContextTag.Travel, ContextTag.Rushed, ContextTag.LowEnergy] },
  { id: 'se-2', day: 'Monday', title: 'Team Standup', startTime: '09:00', endTime: '09:30', contextTags: [ContextTag.Work, ContextTag.HighEnergy] },
  { id: 'se-3', day: 'Monday', title: 'Deep Work: Project Apollo', startTime: '09:30', endTime: '12:00', contextTags: [ContextTag.Work, ContextTag.HighEnergy], bufferMinutes: { prep: 5, recovery: 15 } },
  { id: 'se-4', day: 'Wednesday', title: 'Gym Session', startTime: '18:00', endTime: '19:00', contextTags: [ContextTag.Personal, ContextTag.HighEnergy], bufferMinutes: { prep: 15, recovery: 20 } },
  { id: 'se-5', day: 'Friday', title: 'Coffee & Chill', startTime: '08:15', endTime: '08:45', contextTags: [ContextTag.Personal, ContextTag.Relaxed, ContextTag.LowEnergy] }
];

const mockSmartReminders: SmartReminder[] = [
    { id: 'sr-1', eventId: 'se-2', offsetMinutes: -10, message: 'Review yesterday\'s notes for standup.', why: 'So you feel prepared and on top of your tasks.', isLocked: false, isExploratory: false, status: ReminderStatus.Active, snoozeHistory: [], snoozedUntil: null, successHistory: ['success', 'success', 'snoozed'], lastInteraction: new Date(Date.now() - 86400000).toISOString(), allowExploration: true },
    { id: 'sr-2', eventId: 'se-3', offsetMinutes: -5, message: 'Silence phone and open project docs.', why: 'To minimize distractions for your deep work block.', isLocked: true, isExploratory: false, status: ReminderStatus.Active, snoozeHistory: [], snoozedUntil: null, successHistory: ['success', 'success', 'success'], lastInteraction: new Date(Date.now() - 86400000).toISOString(), allowExploration: false },
    { id: 'sr-3', eventId: 'se-4', offsetMinutes: -30, message: 'Pack gym bag and fill water bottle.', why: 'This reduces friction to get your workout started.', isLocked: false, isExploratory: false, status: ReminderStatus.Active, snoozeHistory: [10, 10, 10], snoozedUntil: null, successHistory: ['snoozed', 'snoozed', 'snoozed', 'success'], lastInteraction: new Date().toISOString(), allowExploration: true },
    { id: 'sr-4', eventId: 'se-4', offsetMinutes: -15, originalOffsetMinutes: -20, message: 'Eat a pre-workout snack.', why: 'Experimenting with energy levels before your gym session.', isLocked: false, isExploratory: true, status: ReminderStatus.Active, snoozeHistory: [], snoozedUntil: null, successHistory: ['ignored', 'ignored'], lastInteraction: new Date().toISOString(), allowExploration: true },
    { id: 'sr-5-stack', eventId: 'se-5', offsetMinutes: 30, message: '5-min stretching.', why: 'Stacking a healthy habit onto your existing coffee routine.', isLocked: false, isExploratory: false, status: ReminderStatus.Active, snoozeHistory: [], snoozedUntil: null, successHistory: [], isStackedHabit: true, lastInteraction: new Date(Date.now() - 86400000).toISOString(), allowExploration: true }
];

const useTheme = (activeMap: MomentumMapData | null, scheduleEvents: ScheduleEvent[], dndWindows: DNDWindow[]) => {
    const [themeSettings, setThemeSettings] = useState<ThemeSettings>(() => {
        try {
            const s = localStorage.getItem('themeSettings');
            const defaultSettings: ThemeSettings = { 
                mode: 'auto', 
                manualTheme: 'Creative',
                customThemeProperties: themePresets.Default,
                userOverrides: {},
            };
            return s ? { ...defaultSettings, ...JSON.parse(s) } : defaultSettings;
        } catch {
             return { mode: 'auto', manualTheme: 'Creative', customThemeProperties: themePresets.Default, userOverrides: {} };
        }
    });
    const [activeThemeName, setActiveThemeName] = useState<ThemeName>('Creative');
    const [themeSuggestion, setThemeSuggestion] = useState<ThemeName | null>(null);

    useEffect(() => {
        localStorage.setItem('themeSettings', JSON.stringify(themeSettings));
    }, [themeSettings]);

    useEffect(() => {
        const activeChunk = activeMap?.chunks.find(c => c.startedAt && !c.completedAt) || null;
        const now = new Date();
        const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        const currentDay = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()];
        
        const currentEvents = scheduleEvents.filter(e => {
            return e.day === currentDay && e.startTime <= currentTime && e.endTime >= currentTime;
        });
        
        const optimalTheme = determineOptimalTheme({
            activeChunk,
            currentEvents,
            currentTime: now,
            dndWindows
        });

        const currentTheme = themeSettings.mode === 'auto' ? activeThemeName : themeSettings.manualTheme;
        
        if (themeSettings.mode === 'auto' && optimalTheme !== currentTheme && optimalTheme !== themeSuggestion) {
            // Don't suggest if user recently overrode.
            const lastOverrideTime = themeSettings.userOverrides.lastOverride;
            if (lastOverrideTime && (Date.now() - lastOverrideTime) < 5 * 60 * 1000) { // 5 min cooldown
              return;
            }
            setThemeSuggestion(optimalTheme);
        } else if (themeSettings.mode === 'manual' && themeSuggestion) {
            setThemeSuggestion(null);
        }

        if (themeSettings.mode === 'manual') {
          setActiveThemeName(themeSettings.manualTheme);
        }

    }, [activeMap, scheduleEvents, dndWindows, themeSettings.mode, activeThemeName, themeSuggestion, themeSettings.manualTheme, themeSettings.userOverrides.lastOverride]);

    useEffect(() => {
        const root = document.documentElement;
        
        // Apply base theme colors
        const themeToApply = themeSettings.mode === 'auto' ? activeThemeName : themeSettings.manualTheme;
        const themeProperties = themes[themeToApply];
        Object.entries(themeProperties).forEach(([key, value]) => {
            root.style.setProperty(key, value);
        });

        // Apply custom properties on top
        const custom = themeSettings.customThemeProperties;
        root.style.setProperty('--animation-speed-modifier', String(custom.animationSpeed));
        root.style.setProperty('--color-intensity-modifier', String(custom.colorIntensity));
        root.style.setProperty('--contrast-modifier', String(custom.contrastLevel));

    }, [activeThemeName, themeSettings]);

    const acceptThemeSuggestion = () => {
        if (themeSuggestion) {
            setActiveThemeName(themeSuggestion);
            setThemeSuggestion(null);
        }
    };
    
    const dismissThemeSuggestion = () => {
        setThemeSuggestion(null);
    };

    const displayThemeName = themeSettings.mode === 'auto' 
      ? `Auto: ${activeThemeName}` 
      : activeThemeName;

    return { themeSettings, setThemeSettings, activeTheme: displayThemeName, themeSuggestion, acceptThemeSuggestion, dismissThemeSuggestion, setActiveThemeName };
};


const Dashboard: React.FC = () => {
  return (
    <main className="container mx-auto p-8">
      <div className="text-center mt-10">
        <h1 className="text-5xl font-extrabold text-[var(--color-text-primary)] mb-4 tracking-tight">
          Welcome to Momentum AI
        </h1>
        <p className="text-xl text-[var(--color-text-secondary)] max-w-2xl mx-auto">
          Your journey to peak productivity starts here. This dashboard will help you visualize progress and organize your ideas effortlessly.
        </p>
        <div className="mt-12 p-10 bg-[var(--color-surface)] rounded-2xl shadow-lg border border-[var(--color-border)]">
           <p className="text-[var(--color-text-secondary)] text-lg">Application content will be built here in subsequent steps.</p>
        </div>
      </div>
    </main>
  );
};

type OnboardingPreviewData = { newAnchors: ScheduleEvent[]; newDnd: DNDWindow[] };

const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState('Momentum Map');
  const [isBrainDumpModalOpen, setIsBrainDumpModalOpen] = useState(false);
  const [isThemeSettingsModalOpen, setIsThemeSettingsModalOpen] = useState(false);
  const [processedItems, setProcessedItems] = useState<BrainDumpItem[]>(() => { try { const i = localStorage.getItem('brainDumpItems'); return i ? JSON.parse(i) : mockBrainDumpItems; } catch { return mockBrainDumpItems; } });
  const [notes, setNotes] = useState<Record<string, Note>>(() => { try { const n = localStorage.getItem('brainDumpNotes'); return n ? JSON.parse(n) : {}; } catch { return {}; } });
  const [savedTasks, setSavedTasks] = useState<SavedTask[]>(() => { try { const t = localStorage.getItem('savedMomentumMaps'); return t ? JSON.parse(t) : mockSavedTasks; } catch { return mockSavedTasks; }});
  const [activeMapData, setActiveMapData] = useState<MomentumMapData | null>(() => { try { const m = localStorage.getItem('activeMapData'); return m ? JSON.parse(m) : null; } catch { return null; } });
  
  const [scheduleEvents, setScheduleEvents] = useState<ScheduleEvent[]>(() => { try { const s = localStorage.getItem('scheduleEvents'); return s ? JSON.parse(s) : []; } catch { return []; } });
  const [smartReminders, setSmartReminders] = useState<SmartReminder[]>(() => { try { const r = localStorage.getItem('smartReminders'); return r ? JSON.parse(r) : []; } catch { return []; } });
  const [dndWindows, setDndWindows] = useState<DNDWindow[]>(() => { try { const d = localStorage.getItem('dndWindows'); return d ? JSON.parse(d) : []; } catch { return []; } });
  const [pauseUntil, setPauseUntil] = useState<string | null>(() => { try { const p = localStorage.getItem('pauseUntil'); return p ? p : null; } catch { return null; } });
  const [onboardingPreview, setOnboardingPreview] = useState<OnboardingPreviewData | null>(() => { try { const p = localStorage.getItem('onboardingPreview'); return p ? JSON.parse(p) : null; } catch { return null; } });

  const [completionHistory, setCompletionHistory] = useState<Record<EnergyTag, CompletionRecord[]>>(() => getCompletionHistory());
  const [timeLearningSettings, setTimeLearningSettings] = useState<TimeLearningSettings>(() => {
    try {
        const s = localStorage.getItem('timeLearningSettings');
        return s ? JSON.parse(s) : { isEnabled: true, sensitivity: 0.3 };
    } catch {
        return { isEnabled: true, sensitivity: 0.3 };
    }
  });
  
  const { themeSettings, setThemeSettings, activeTheme, themeSuggestion, acceptThemeSuggestion, dismissThemeSuggestion, setActiveThemeName } = useTheme(activeMapData, scheduleEvents, dndWindows);

  const [error, setError] = useState<string|null>(null);

  useEffect(() => { localStorage.setItem('brainDumpItems', JSON.stringify(processedItems)); }, [processedItems]);
  useEffect(() => { localStorage.setItem('brainDumpNotes', JSON.stringify(notes)); }, [notes]);
  useEffect(() => { localStorage.setItem('savedMomentumMaps', JSON.stringify(savedTasks)); }, [savedTasks]);
  useEffect(() => { 
    if (activeMapData) {
      localStorage.setItem('activeMapData', JSON.stringify(activeMapData)); 
    } else {
      localStorage.removeItem('activeMapData');
    }
  }, [activeMapData]);
  useEffect(() => { localStorage.setItem('scheduleEvents', JSON.stringify(scheduleEvents)); }, [scheduleEvents]);
  useEffect(() => { localStorage.setItem('smartReminders', JSON.stringify(smartReminders)); }, [smartReminders]);
  useEffect(() => { localStorage.setItem('dndWindows', JSON.stringify(dndWindows)); }, [dndWindows]);
  useEffect(() => { 
    if (pauseUntil) {
      localStorage.setItem('pauseUntil', pauseUntil); 
    } else {
      localStorage.removeItem('pauseUntil');
    }
  }, [pauseUntil]);
   useEffect(() => { 
    if (onboardingPreview) {
      localStorage.setItem('onboardingPreview', JSON.stringify(onboardingPreview)); 
    } else {
      localStorage.removeItem('onboardingPreview');
    }
  }, [onboardingPreview]);
  useEffect(() => {
    localStorage.setItem('timeLearningSettings', JSON.stringify(timeLearningSettings));
  }, [timeLearningSettings]);
  
  // Emergency Calm Mode Shortcut
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key === 'E') {
        event.preventDefault();
        setThemeSettings(prev => ({
          ...prev,
          mode: 'manual',
          manualTheme: 'Recovery',
          customThemeProperties: themePresets['Minimal Stimulation'],
        }));
        setIsThemeSettingsModalOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setThemeSettings]);


  const handleBrainDumpSubmit = async (text: string) => {
    setError(null);
    try {
      const newItems = await processWithGemini(text);
      setProcessedItems(prev => [...prev, ...newItems]);
      handleNavigate('Brain Dump');
    } catch (e: any) {
      setError(e.message);
      throw e;
    }
  };
  
  const handleNavigate = (page: string) => {
    setCurrentPage(page);
  };

  const handleResumeMap = (task: SavedTask) => {
    setActiveMapData(task.mapData);
    handleNavigate('Momentum Map');
  };

  const handleNewCompletionRecord = (record: Omit<CompletionRecord, 'id'>) => {
    if (!timeLearningSettings.isEnabled) return;
    const newHistory = addRecordToHistory(record);
    setCompletionHistory(newHistory);
  };

  const renderPage = () => {
    switch (currentPage) {
      case 'Dashboard':
        return <Dashboard />;
      case 'Momentum Map':
        return <MomentumMap 
                  activeMap={activeMapData}
                  setActiveMap={setActiveMapData}
                  setSavedTasks={setSavedTasks}
                  completionHistory={completionHistory}
                  onNewCompletionRecord={handleNewCompletionRecord}
                  timeLearningSettings={timeLearningSettings}
                />;
      case 'Brain Dump':
        return <BrainDump 
                  processedItems={processedItems}
                  setProcessedItems={setProcessedItems}
                  notes={notes}
                  setNotes={setNotes}
                  handleProcess={handleBrainDumpSubmit}
                  error={error}
                  setError={setError}
                />;
      case 'Task':
        return <TaskPage 
                  savedTasks={savedTasks} 
                  setSavedTasks={setSavedTasks}
                  onResume={handleResumeMap} 
                />;
      case 'Calendar':
        return <CalendarPage
                  scheduleEvents={scheduleEvents}
                  setScheduleEvents={setScheduleEvents}
                  smartReminders={smartReminders}
                  setSmartReminders={setSmartReminders}
                  dndWindows={dndWindows}
                  setDndWindows={setDndWindows}
                  pauseUntil={pauseUntil}
                  setPauseUntil={setPauseUntil}
                  onboardingPreview={onboardingPreview}
                  setOnboardingPreview={setOnboardingPreview}
                />;
      case 'Settings':
        return <TimeLearningSettingsPage
                  settings={timeLearningSettings}
                  setSettings={setTimeLearningSettings}
                  completionHistory={completionHistory}
                  setCompletionHistory={setCompletionHistory}
                />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <div className="min-h-screen antialiased">
      <Navbar 
        currentPage={currentPage} 
        onNavigate={handleNavigate} 
        onBrainDumpClick={() => setIsBrainDumpModalOpen(true)} 
        onThemeClick={() => setIsThemeSettingsModalOpen(true)}
        activeTheme={activeTheme}
      />
      {renderPage()}
      <BrainDumpModal 
        isOpen={isBrainDumpModalOpen}
        onClose={() => setIsBrainDumpModalOpen(false)}
        onSubmit={handleBrainDumpSubmit}
      />
      <ThemeSettingsModal
        isOpen={isThemeSettingsModalOpen}
        onClose={() => setIsThemeSettingsModalOpen(false)}
        settings={themeSettings}
        setSettings={setThemeSettings}
        onThemeSelect={setActiveThemeName}
      />
      <ThemeSuggestionToast
        suggestion={themeSuggestion}
        onAccept={acceptThemeSuggestion}
        onDismiss={dismissThemeSuggestion}
      />
    </div>
  );
};

export default App;
