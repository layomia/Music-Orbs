import { Type } from "@google/genai";

export type ReverbType = "dry" | "room" | "hall";

export interface Track {
  id: "drums" | "piano" | "guitar" | "vocals";
  label: string;
  volume: number; // 0 to 100
  delay: number;  // 0 to 3
  reverb: ReverbType;
  selected: boolean;
  muted: boolean;
}

export interface GestureFeatures {
  radius: number;
  circularity: number;
  speed: number;
  steadiness: number;
  duration: number;
}

export interface Proposal {
  id: string;
  title: string;
  rationale: string;
  changes: {
    volumeDelta: number;
    delayDelta: number;
    reverbTarget: ReverbType;
  };
  isEnhanced?: boolean;
}

export interface HistoryItem {
  id: string;
  timestamp: number;
  trackId: string;
  proposalTitle?: string;
  description?: string;
  previousState: Partial<Track>;
  newState: Partial<Track>;
  type: 'direct' | 'conductor';
}

export interface AdaptiveState {
  rejectionCount: number;
  acceptCount: number;
  reverbBias: number; // Positive for more reverb
  intensityBias: number; // 0.0 to 1.0 multiplier
  lastAction: 'accept' | 'reject' | 'generate' | null;
  feedbackMessage: string | null;
  feedbackTimestamp: number | null;
}

export const PROPOSAL_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      title: { type: Type.STRING },
      rationale: { type: Type.STRING },
      changes: {
        type: Type.OBJECT,
        properties: {
          volumeDelta: { type: Type.NUMBER, description: "Change in volume, bounded -20 to 20" },
          delayDelta: { type: Type.NUMBER, description: "Change in delay, bounded -1 to 1" },
          reverbTarget: { type: Type.STRING, enum: ["dry", "room", "hall"] }
        },
        required: ["volumeDelta", "delayDelta", "reverbTarget"]
      }
    },
    required: ["id", "title", "rationale", "changes"]
  }
};
