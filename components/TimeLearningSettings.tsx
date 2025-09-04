import React, { useMemo } from 'react';
import { TimeLearningSettings, CompletionRecord, EnergyTag } from '../types';
import { resetCompletionHistory } from '../utils/timeAnalytics';

interface Props {
    settings: TimeLearningSettings;
    setSettings: React.Dispatch<React.SetStateAction<TimeLearningSettings>>;
    completionHistory: Record<EnergyTag, CompletionRecord[]>;
    setCompletionHistory: React.Dispatch<React.SetStateAction<Record<EnergyTag, CompletionRecord[]>>>;
}

const TimeLearningSettingsPage: React.FC<Props> = ({ settings, setSettings, completionHistory, setCompletionHistory }) => {
    
    const handleReset = () => {
        if (window.confirm("Are you sure? This will delete all your time estimation learning data.")) {
            resetCompletionHistory();
            setCompletionHistory(Object.values(EnergyTag).reduce((acc, tag) => ({ ...acc, [tag]: [] }), {} as Record<EnergyTag, CompletionRecord[]>));
        }
    };

    const handleExport = () => {
        const dataStr = JSON.stringify(completionHistory, null, 2);
        const blob = new Blob([dataStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = 'momentum-map-history.json';
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
    };

    const stats = useMemo(() => {
        const allRecords = Object.values(completionHistory).flat();
        if (allRecords.length < 3) return null;

        let totalOriginalDeviation = 0;
        
        allRecords.forEach(rec => {
            totalOriginalDeviation += Math.abs(rec.estimatedDurationMinutes - rec.actualDurationMinutes);
        });

        const avgOriginalDeviation = totalOriginalDeviation / allRecords.length;
        const totalRecords = allRecords.length;

        return {
            avgOriginalDeviation: avgOriginalDeviation.toFixed(1),
            totalRecords: totalRecords
        }

    }, [completionHistory]);

    return (
        <main className="container mx-auto p-8 max-w-2xl">
            <h1 className="text-4xl font-bold text-stone-800 mb-2">Time Learning Settings</h1>
            <p className="text-stone-600 mb-8">Manage how Momentum Map learns from your work patterns to personalize your time estimates.</p>
            
            <div className="space-y-6">
                <div className="bg-white p-6 rounded-2xl shadow-sm border">
                    <h2 className="text-xl font-bold text-stone-800 mb-4">General</h2>
                    <div className="flex justify-between items-center">
                        <label htmlFor="enable-learning" className="font-semibold text-stone-700">Enable Personalized Estimates</label>
                        <input type="checkbox" id="enable-learning" checked={settings.isEnabled} onChange={e => setSettings(s => ({ ...s, isEnabled: e.target.checked }))} className="h-6 w-11 appearance-none rounded-full bg-stone-300 checked:bg-[#5A9A78] transition-colors duration-200 ease-in-out relative cursor-pointer before:content-[''] before:h-5 before:w-5 before:rounded-full before:bg-white before:absolute before:top-0.5 before:left-0.5 before:transition-transform before:duration-200 before:ease-in-out checked:before:translate-x-5" />
                    </div>
                </div>

                <div className={`bg-white p-6 rounded-2xl shadow-sm border transition-opacity ${!settings.isEnabled ? 'opacity-50' : ''}`}>
                    <h2 className="text-xl font-bold text-stone-800 mb-4">Configuration</h2>
                    <div className="space-y-4">
                        <div>
                            <label htmlFor="sensitivity" className="font-semibold text-stone-700">Learning Sensitivity</label>
                            <p className="text-sm text-stone-500 mb-2">How much weight to give your most recent tasks. Higher is more reactive.</p>
                            <input type="range" id="sensitivity" min="0.1" max="0.9" step="0.1" value={settings.sensitivity} onChange={e => setSettings(s => ({ ...s, sensitivity: parseFloat(e.target.value) }))} disabled={!settings.isEnabled} className="w-full" />
                        </div>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-2xl shadow-sm border">
                    <h2 className="text-xl font-bold text-stone-800 mb-4">Performance Dashboard</h2>
                    {stats ? (
                        <div className="text-center">
                             <p className="text-stone-600">Based on <span className="font-bold">{stats.totalRecords}</span> completed chunks, your original estimates were off by an average of <span className="font-bold">{stats.avgOriginalDeviation} minutes</span>. The system is learning to reduce this gap.</p>
                        </div>
                    ) : (
                        <p className="text-stone-600 text-center">Complete a few more chunks to see your performance data here.</p>
                    )}
                </div>

                <div className="bg-white p-6 rounded-2xl shadow-sm border">
                    <h2 className="text-xl font-bold text-stone-800 mb-4">Data Management</h2>
                    <div className="flex justify-between items-center gap-4">
                        <button onClick={handleExport} className="flex-1 px-4 py-2 font-semibold text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-lg">Export My Data</button>
                        <button onClick={handleReset} className="flex-1 px-4 py-2 font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg">Reset Learning Data</button>
                    </div>
                </div>
            </div>
        </main>
    );
};
export default TimeLearningSettingsPage;
