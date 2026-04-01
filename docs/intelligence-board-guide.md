# Intelligence Board — VA Guide

> This document explains every section of the Intelligence Board page so anyone with zero technical knowledge can understand what each section does, why it matters, and what to do about the alerts.

## Overview

The Intelligence Board is the decision-making center of the dashboard. It automatically analyzes all active ads and surfaces problems, opportunities, and recommendations. Data syncs from Meta Ads + Ghstly APIs 4x daily (6am, 12pm, 6pm, midnight PT).

**Important:** When data is Degraded (only one source synced) or Stale (neither synced recently), ALL recommendation sections are hidden. This prevents making spend decisions on unreliable data.

---

## 1. Performance Tiers

**What it shows:** Every ad auto-classified into a performance tier from Perfect to Critical.

**How it works:** Each ad is evaluated against 3 metrics. The worst metric determines the overall tier:

| Metric | Perfect | Good | Below Target | Poor | Critical |
|--------|---------|------|--------------|------|----------|
| Chat Rate | 85%+ | 75-84% | 50-64% | 40-49% | <40% |
| Cost Per Chat | <=$0.20 | $0.21-$0.40 | $0.41-$0.50 | $0.51-$0.60 | >$0.60 |
| Reveal Rate | 40%+ | 30-39% | 25-29% | 20-24% | <20% |

**Suppression:** Requires 50+ visits AND fresh data. Ads with too few visits show "Insufficient Data."

**What to do:**
- Perfect/Really Good = Scale budget
- Good/Okay = Maintain and monitor
- Below Target = Flag and investigate
- Poor/Critical = Consider pausing

---

## 2. Anomalies

**What it shows:** Sudden performance changes — drops or spikes.

**How it works:** Compares the **last 3 days** vs the **prior 3 days** for each ad. Any metric that swings by more than 15% gets flagged.

**Example alerts:**
- "Chat rate dropped from 82% to 55% in 3 days"
- "Cost per chat spiked from $0.30 to $0.65"

**What to do:**
- Check if the ad creative was changed recently
- Check if targeting was modified
- Check if the landing page had issues
- If no obvious cause, monitor for 1 more day before acting

**No anomalies = stable performance. This is good.**

---

## 3. Data Quality

**What it shows:** Whether Meta and Ghstly data agree with each other.

**How it works:** Compares Ghstly session counts (chats, reveals, click-throughs) against Ghstly daily stats for the same period. If they diverge by more than 10%, it flags a data quality breach.

**Common causes of breaches:**
- Broken UTM tracking on ad links
- Ghstly API sync delays
- Sessions not properly attributed to ads

**What to do:**
- If breach appears: notify the team, check UTM parameters on recent ads
- If persistent: the dashboard numbers may not be trustworthy for affected ads

**No issues = data is consistent. Numbers are reliable.**

---

## 4. Creative-Funnel Mismatches

**What it shows:** Ads where creative performance doesn't match funnel performance — a disconnect in the user journey.

**Two patterns detected:**

### CLICK > CHAT (orange cards)
- High click-through rate (50%+) BUT low chat rate (<50%)
- **Meaning:** The creative and landing page attract clicks, but visitors don't start chatting
- **Fix:** A/B test the chat greeting, chat bubble placement, or landing page layout

### CHAT > REVEAL (yellow cards)
- High chat rate (70%+) BUT low reveal rate (<25%)
- **Meaning:** People are chatting enthusiastically but not reaching the reveal step
- **Fix:** Adjust the AI persona's reveal timing or messaging

**Requires 50+ visits per ad in the 7-day window.**

---

## 5. Budget Recommendations

**What it shows:** Which ads to pause/reduce and which to scale, with specific dollar amounts.

### Kill List (red section)
- Ads rated **Poor or Critical** that are actively spending >$1/day
- **PAUSE** = Critical tier, stop spending entirely
- **REDUCE** = Poor or Below Target, cut spend by 30-50%
- Shows: current spend, suggested spend, potential savings

### Scale List (green section)
- Ads rated **Perfect or Really Good** that are spending below the median
- Room to increase budget and get more chats at similar cost
- Shows: current spend, suggested increase amount

### Each card includes:
- **Ad name** and creative thumbnail
- **Per-metric breakdown** showing actual values and which thresholds they crossed
- **Specific advice** based on what's dragging performance (targeting, creative match, chat experience)
- **Dollar impact** — how much you'd save or could reallocate

**All recommendations are advisory only.** The dashboard never pauses, scales, or modifies ads in Meta automatically. You must take action manually.

---

## 6. Freshness & Data States

The header shows the current data state:

| State | Badge | Meaning | Recommendations |
|-------|-------|---------|----------------|
| **Fresh** | Green | Both Meta + Ghstly synced within last 6 hours | All sections active |
| **Degraded** | Yellow | Only one source synced | Cross-source metrics hidden |
| **Stale** | Red | Neither synced recently | All recommendations suppressed |

**"Data as of" timestamps** show exactly when each source was last synced.

---

## Quick Reference for VAs

| Section | Check frequency | Action when alerts appear |
|---------|----------------|---------------------------|
| Performance Tiers | Daily | Flag Critical/Poor ads for Max to review |
| Anomalies | Daily | Investigate cause, report if >20% swing |
| Data Quality | Weekly | Report breaches to team for UTM check |
| Mismatches | Weekly | Note which ads have disconnects |
| Budget Recs | Daily | Send kill/scale list to Max for approval |
| Freshness | Every visit | If Stale, don't make decisions — wait for sync |
