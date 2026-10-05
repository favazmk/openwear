/**
 * OpenWear - AI Health & Telemetry Coach
 * Analyzes multi-vendor biometric time-series data, generates recovery forecasts,
 * detects physiological anomalies, and interfaces with OpenAI Codex / GPT models.
 */

export class TelemetryCoach {
  constructor(apiKey = null) {
    this.apiKey = apiKey || (typeof process !== 'undefined' ? process.env?.VITE_OPENAI_API_KEY : null);
    this.chatHistory = [];
  }

  setApiKey(key) {
    this.apiKey = key;
  }

  /**
   * Perform comprehensive automated physiological telemetry audit
   */
  analyzeTelemetry(telemetry, recoveryInfo) {
    const { vitals, sleep, activity, recentWorkouts } = telemetry;
    const anomalies = [];
    const insights = [];

    // 1. HRV Autonomic Tone Check
    if (vitals.hrv < 45) {
      anomalies.push({
        type: 'warning',
        title: 'Suppressed Autonomic Tone (HRV)',
        description: `HRV dropped to ${vitals.hrv}ms. Suggests sympathetic nervous system overload, insufficient sleep recovery, or latent immune response.`
      });
    } else if (vitals.hrv >= 65) {
      insights.push({
        type: 'positive',
        title: 'High Parasympathetic Dominance',
        description: `HRV is robust at ${vitals.hrv}ms. High cardiovascular resilience and readiness for threshold efforts.`
      });
    }

    // 2. Resting Heart Rate Drift
    if (vitals.restingHeartRate > 68) {
      anomalies.push({
        type: 'caution',
        title: 'Elevated Resting Heart Rate',
        description: `Resting HR is elevated (+${vitals.restingHeartRate - 60} bpm above optimal baseline). Monitor hydration and evening screen exposure.`
      });
    }

    // 3. Sleep Architecture Analysis
    const deepPercent = Math.round((sleep.deepMinutes / sleep.totalMinutes) * 100);
    const remPercent = Math.round((sleep.remMinutes / sleep.totalMinutes) * 100);

    if (deepPercent < 15) {
      anomalies.push({
        type: 'warning',
        title: 'Deep Sleep Deficit',
        description: `Deep sleep was only ${deepPercent}% (${sleep.deepMinutes}m). Physical muscular repair and growth hormone secretion may be impaired.`
      });
    } else {
      insights.push({
        type: 'positive',
        title: 'Optimal Deep Restoration',
        description: `Achieved ${sleep.deepMinutes}m of Slow-Wave Sleep (${deepPercent}% of total). Cellular regeneration is optimal.`
      });
    }

    // 4. Activity Strain & Workload Ratio
    const latestWorkout = recentWorkouts[0];
    let workoutAnalysis = 'No recent high-intensity workout recorded today.';
    if (latestWorkout) {
      workoutAnalysis = `Completed ${latestWorkout.title} (${latestWorkout.durationMinutes}m, avg HR ${latestWorkout.avgHeartRate} bpm, ${latestWorkout.calories} kcal). Good cardiac response in zone 3-4.`;
    }

    return {
      recoveryScore: recoveryInfo.score,
      recoveryTier: recoveryInfo.status,
      advisory: recoveryInfo.advisory,
      anomalies,
      insights,
      workoutSummary: workoutAnalysis,
      timestamp: new Date().toLocaleTimeString()
    };
  }

  /**
   * Ask the AI Coach a custom health, workout, or telemetry question
   */
  async askCoach(userQuestion, telemetry, recoveryInfo) {
    // If OpenAI API key is supplied, query OpenAI Codex / Chat API
    if (this.apiKey) {
      try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: `You are OpenWear AI, an elite sports science and biometric telemetry expert. You analyze real-time multi-wearable data (Apple Health, Google Fit, Strava, Garmin, boAt). Keep responses concise, authoritative, and actionable.`
              },
              {
                role: 'user',
                content: `Context:
Heart Rate: ${telemetry.vitals.heartRate} bpm (Resting: ${telemetry.vitals.restingHeartRate} bpm)
HRV: ${telemetry.vitals.hrv} ms
SpO2: ${telemetry.vitals.spo2}%
Steps: ${telemetry.activity.steps}
Sleep: ${Math.floor(telemetry.sleep.totalMinutes / 60)}h ${telemetry.sleep.totalMinutes % 60}m (Deep: ${telemetry.sleep.deepMinutes}m)
Recovery Score: ${recoveryInfo.score}/100 (${recoveryInfo.status})
Recent Workouts: ${JSON.stringify(telemetry.recentWorkouts)}

User Question: ${userQuestion}`
              }
            ],
            temperature: 0.6,
            max_tokens: 350
          })
        });

        if (response.ok) {
          const data = await response.json();
          const reply = data.choices[0]?.message?.content;
          if (reply) return reply;
        }
      } catch (err) {
        console.warn('OpenAI API request failed, falling back to local heuristic model:', err);
      }
    }

    // Local Intelligent Heuristic Fallback
    return this.generateHeuristicResponse(userQuestion, telemetry, recoveryInfo);
  }

  /**
   * Offline Heuristic Rule Engine (zero external API required)
   */
  generateHeuristicResponse(question, telemetry, recoveryInfo) {
    const q = question.toLowerCase();
    const { vitals, sleep, activity } = telemetry;

    if (q.includes('sleep') || q.includes('tired') || q.includes('rem') || q.includes('deep')) {
      return `📊 **Sleep Architecture Analysis:**
You logged ${Math.floor(sleep.totalMinutes / 60)}h ${sleep.totalMinutes % 60}m with ${sleep.deepMinutes}m deep sleep (${Math.round((sleep.deepMinutes / sleep.totalMinutes) * 100)}%) and ${sleep.remMinutes}m REM.
Your sleep efficiency was ${sleep.efficiencyPercent}%. Sleep Score: **${sleep.sleepScore}/100**.
💡 *Coach Recommendation:* With ${sleep.awakeMinutes}m awake time, your recovery is solid. Try dimming ambient lighting 45 mins before bedtime to extend deep wave onset.`;
    }

    if (q.includes('train') || q.includes('workout') || q.includes('run') || q.includes('hard') || q.includes('recovery')) {
      if (recoveryInfo.score >= 80) {
        return `⚡ **Training Recommendation:**
Your Recovery Score is **${recoveryInfo.score}/100 (Optimal)**!
HRV is healthy at ${vitals.hrv}ms and resting HR is baseline (${vitals.restingHeartRate} bpm).
💪 *Verdict:* Fully cleared for high-intensity intervals (Zone 4/5), tempo runs, or progressive overload strength sessions today.`;
      } else {
        return `⚠️ **Training Recommendation:**
Your Recovery Score is **${recoveryInfo.score}/100 (${recoveryInfo.status})**.
HRV indicates heightened physiological fatigue.
🧘 *Verdict:* Opt for Zone 2 aerobic base work, mobility stretches, or a 30-minute recovery walk rather than threshold intervals.`;
    }
  }

    if (q.includes('hrv') || q.includes('heart') || q.includes('pulse') || q.includes('spo2')) {
      return `❤️ **Biometric Telemetry Breakdown:**
- **Current HR:** ${vitals.heartRate} bpm
- **Resting HR:** ${vitals.restingHeartRate} bpm (Normal target: 55-65 bpm)
- **HRV (RMSSD):** ${vitals.hrv} ms (${vitals.hrv > 60 ? 'Optimal parasympathetic tone' : 'Moderate tone'})
- **Blood Oxygen (SpO2):** ${vitals.spo2}% (${vitals.spo2 >= 98 ? 'Optimal arterial saturation' : 'Standard'})
- **Stress Index:** ${vitals.stressIndex}/100 (Low-Moderate)`;
    }

    if (q.includes('python') || q.includes('code') || q.includes('export') || q.includes('sql') || q.includes('pandas')) {
      return `\`\`\`python
# OpenWear Telemetry Data Export -> Pandas DataFrame
import pandas as pd
import numpy as np

telemetry_data = {
    "timestamp": ["${new Date().toISOString()}"],
    "heart_rate": [${vitals.heartRate}],
    "hrv_ms": [${vitals.hrv}],
    "spo2_pct": [${vitals.spo2}],
    "steps": [${activity.steps}],
    "recovery_score": [${recoveryInfo.score}]
}

df = pd.DataFrame(telemetry_data)
df["hr_zone"] = pd.cut(df["heart_rate"], bins=[0, 100, 130, 155, 175, 220], 
                       labels=["Rest", "Zone 1", "Zone 2", "Zone 3", "Zone 4+"])
print(df.to_markdown())
\`\`\`
✨ *Generated via OpenWear Telemetry Schema.*`;
    }

    return `🎯 **OpenWear AI Synthesis:**
Your current telemetry across connected devices indicates a **${recoveryInfo.score}/100 Recovery Score** with **${activity.steps.toLocaleString()} steps** recorded so far today.
- **Heart Rate:** ${vitals.heartRate} bpm (Resting ${vitals.restingHeartRate} bpm)
- **HRV:** ${vitals.hrv} ms
- **Sleep Quality:** ${sleep.sleepScore}/100

You can ask me to analyze sleep stages, check training readiness, or export telemetry code into Python/SQL!`;
  }
}
