import { GoogleGenAI } from "@google/genai";
import { Track, Proposal, PROPOSAL_SCHEMA, GestureFeatures } from "./types";

export function extractGestureFeatures(points: { x: number, y: number, t: number }[]): GestureFeatures {
  if (points.length < 2) return { radius: 0, circularity: 0, speed: 0, steadiness: 0, duration: 0 };

  const duration = points[points.length - 1].t - points[0].t;
  let totalDist = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let speeds: number[] = [];

  for (let i = 1; i < points.length; i++) {
    const d = Math.sqrt(Math.pow(points[i].x - points[i - 1].x, 2) + Math.pow(points[i].y - points[i - 1].y, 2));
    totalDist += d;
    const dt = points[i].t - points[i - 1].t || 1;
    speeds.push(d / dt);
    minX = Math.min(minX, points[i].x);
    maxX = Math.max(maxX, points[i].x);
    minY = Math.min(minY, points[i].y);
    maxY = Math.max(maxY, points[i].y);
  }

  const avgSpeed = totalDist / duration;
  const width = maxX - minX;
  const height = maxY - minY;
  const radius = (width + height) / 4;
  
  // Simple circularity: ratio of distance traveled to perimeter of bounding box
  const circularity = totalDist / (2 * (width + height) || 1);
  
  // Steadiness: inverse of speed variance
  const meanSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  const variance = speeds.reduce((a, b) => a + Math.pow(b - meanSpeed, 2), 0) / speeds.length;
  const steadiness = 1 / (1 + variance * 1000);

  return { radius, circularity, speed: avgSpeed, steadiness, duration };
}

export function generateLocalProposals(
  gesture: GestureFeatures,
  text: string,
  track: Track
): Proposal[] {
  const isWide = gesture.radius > 50;
  const isFast = gesture.speed > 0.5;
  const isSteady = gesture.steadiness > 0.5;
  const isCircular = gesture.circularity > 0.8;

  const intent = text.toLowerCase();

  // Heuristic mapping
  let baseVol = 0;
  let baseDelay = 0;
  let baseReverb: "dry" | "room" | "hall" = track.reverb;

  if (isWide || intent.includes("roomy") || intent.includes("wider")) {
    baseVol -= 5;
    baseDelay += 0.5;
    baseReverb = "hall";
  } else if (intent.includes("closer") || (gesture.radius < 20 && isSteady)) {
    baseVol += 10;
    baseDelay -= 0.5;
    baseReverb = "dry";
  }

  if (isFast || intent.includes("punchier")) {
    baseVol += 15;
  }

  if (!isSteady || intent.includes("atmospheric")) {
    baseDelay += 1;
    baseReverb = "hall";
  }

  return [
    {
      id: `local-1-${Date.now()}`,
      title: "Immediate Interpretation",
      rationale: "Based on your movement, this brings a balanced shift to the track.",
      changes: { 
        volumeDelta: Math.max(-20, Math.min(20, baseVol)), 
        delayDelta: Math.max(-1, Math.min(1, baseDelay)), 
        reverbTarget: baseReverb 
      }
    },
    {
      id: `local-2-${Date.now()}`,
      title: "Subtle Variant",
      rationale: "A gentler version of the detected intent.",
      changes: { 
        volumeDelta: Math.max(-20, Math.min(20, baseVol * 0.5)), 
        delayDelta: Math.max(-1, Math.min(1, baseDelay * 0.5)), 
        reverbTarget: baseReverb === "hall" ? "room" : baseReverb 
      }
    },
    {
      id: `local-3-${Date.now()}`,
      title: "Bold Alternative",
      rationale: "Pushing the expressive qualities further.",
      changes: { 
        volumeDelta: Math.max(-20, Math.min(20, baseVol * 1.5)), 
        delayDelta: Math.max(-1, Math.min(1, baseDelay * 1.5)), 
        reverbTarget: baseReverb === "dry" ? "room" : "hall" 
      }
    }
  ];
}

export async function generateProposals(
  input: string,
  selectedTrack: Track,
  apiKey?: string
): Promise<Proposal[]> {
  // For now, we use dummy gesture features if not provided by a real gesture system
  const dummyGesture: GestureFeatures = { radius: 0, circularity: 0, speed: 0, steadiness: 0, duration: 0 };
  const local = generateLocalProposals(dummyGesture, input, selectedTrack);
  return enhanceProposalsWithAI(input, dummyGesture, selectedTrack, local, apiKey);
}

export async function enhanceProposalsWithAI(
  input: string,
  gesture: GestureFeatures,
  selectedTrack: Track,
  localProposals: Proposal[],
  apiKey?: string
): Promise<Proposal[]> {
  if (!apiKey) return localProposals;

  const ai = new GoogleGenAI({ apiKey });
  const model = "gemini-3-flash-preview";

  const prompt = `
    You are assisting novice music mixing. 
    Selected Track: ${selectedTrack.label}
    Current State: Volume ${selectedTrack.volume}, Delay ${selectedTrack.delay}, Reverb ${selectedTrack.reverb}
    User Intent (Text): "${input}"
    User Gesture: Radius ${gesture.radius.toFixed(1)}, Speed ${gesture.speed.toFixed(2)}, Circularity ${gesture.circularity.toFixed(2)}

    I have generated 3 local draft proposals. Please refine their titles and rationales to be more evocative and novice-friendly, while keeping the parameter changes similar or slightly improved based on the intent.
    
    Drafts: ${JSON.stringify(localProposals)}

    Return exactly 3 proposals in JSON format.
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: PROPOSAL_SCHEMA
      }
    });

    const text = response.text;
    if (!text) {
      throw new Error("Empty response from AI");
    }

    const enhanced = JSON.parse(text);
    if (!Array.isArray(enhanced)) {
      throw new Error("AI did not return an array of proposals");
    }

    return enhanced.map((p: any) => ({ 
      ...p, 
      id: p.id || `ai-${Math.random().toString(36).substr(2, 9)}`,
      isEnhanced: true 
    }));
  } catch (error) {
    console.warn("AI Enhancement failed, using local:", error);
    return localProposals;
  }
}
