import { ThemeName, Chunk, ScheduleEvent, EnergyTag, ContextTag, DNDWindow } from '../types';

interface ThemeContext {
    activeChunk: Chunk | null;
    currentEvents: ScheduleEvent[];
    currentTime: Date;
    dndWindows: DNDWindow[];
}

const timeToMinutes = (time: string): number => {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
};

export const determineOptimalTheme = (context: ThemeContext): ThemeName => {
    const { activeChunk, currentEvents, currentTime, dndWindows } = context;
    const currentHour = currentTime.getHours();
    const currentDayOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][currentTime.getDay()] as ScheduleEvent['day'];
    const currentTimeInMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();

    // Priority 1: Evening theme (sensory wind-down)
    if (currentHour >= 19 || currentHour < 5) {
        return 'Evening';
    }

    // Priority 2: DND windows for forced focus
    const activeDndWindow = dndWindows.find(w => w.day === currentDayOfWeek);
    if (activeDndWindow) {
        const dndStart = timeToMinutes(activeDndWindow.startTime);
        const dndEnd = timeToMinutes(activeDndWindow.endTime);

        // Handle overnight DND (e.g., 22:00 to 06:00)
        if (dndEnd < dndStart) {
            if (currentTimeInMinutes >= dndStart || currentTimeInMinutes < dndEnd) {
                return 'Focus';
            }
        } else { // Handle same-day DND
            if (currentTimeInMinutes >= dndStart && currentTimeInMinutes < dndEnd) {
                return 'Focus';
            }
        }
    }

    // Priority 3: Active Momentum Map Chunk
    if (activeChunk && !activeChunk.isComplete) {
        switch (activeChunk.energyTag) {
            case EnergyTag.Tedious:
            case EnergyTag.Admin:
                return 'Focus';
            case EnergyTag.Creative:
            case EnergyTag.Social: // Updated for more vibrant theme during social tasks
                return 'Creative';
            case EnergyTag.Errand:
                return 'Recovery';
            default:
                return 'Creative';
        }
    }
    
    // Priority 4: Current Scheduled Events (Anchors)
    if (currentEvents.length > 0) {
        const hasRushedTag = currentEvents.some(event => 
            event.contextTags?.includes(ContextTag.Rushed)
        );
        // "Rushed" gets highest priority within calendar events for high-contrast UI
        if (hasRushedTag) {
            return 'Focus';
        }

        const hasHighEnergyTag = currentEvents.some(event => 
            event.contextTags?.includes(ContextTag.HighEnergy) ||
            event.contextTags?.includes(ContextTag.Work)
        );
        if (hasHighEnergyTag) {
            return 'Focus';
        }
        
        const hasRelaxedTag = currentEvents.some(event => 
            event.contextTags?.includes(ContextTag.Relaxed)
        );
        // "Relaxed" should be more calming
        if (hasRelaxedTag) {
            return 'Recovery';
        }

        const hasLowEnergyTag = currentEvents.some(event => 
            event.contextTags?.includes(ContextTag.LowEnergy) ||
            event.contextTags?.includes(ContextTag.Recovery)
        );
        if (hasLowEnergyTag) {
            return 'Recovery';
        }
    }

    // Default theme if no other context applies
    return 'Creative';
};
