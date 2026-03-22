/**
 * Ads Intelligence Docs — /dashboard/docs
 *
 * Complete reference for the Ghstly ad creative pipeline.
 * Tutorial workflows, NB2 JSON prompt reference, creative rules, and benchmarks.
 */

export const dynamic = "force-dynamic";

const TOC_ITEMS = [
  { id: "overview", label: "Overview" },
  { id: "explore-exploit-framework", label: "Explore / Exploit" },
  { id: "workflow-explore", label: "New Concepts" },
  { id: "workflow-exploit", label: "Iterate Winners" },
  { id: "workflow-quick", label: "Quick Creatives" },
  { id: "testing-cycle", label: "Testing Cycle" },
  { id: "common-mistakes", label: "Common Mistakes" },
  { id: "nb2-json-prompt-format", label: "NB2 JSON Format" },
  { id: "ghstly-creative-rules", label: "Creative Rules" },
  { id: "format-categories", label: "Format Tiers" },
  { id: "canonical-negative-prompt-list", label: "Negative Prompts" },
  { id: "text-rendering-tips", label: "Text Rendering" },
  { id: "ad-copy-patterns", label: "Ad Copy" },
  { id: "performance-benchmarks", label: "Benchmarks" },
];

export default function DocsPage() {
  return (
    <section className="docs-page">
      <header className="docs-header">
        <h1>Ads Intelligence Docs</h1>
        <p className="docs-subtitle">
          Complete guide to the Ghstly ad creative pipeline. How to generate new
          concepts, iterate on winners, deploy tests, and read results.
        </p>
      </header>

      <nav className="docs-toc">
        <span className="docs-toc-label">Jump to</span>
        {TOC_ITEMS.map((item) => (
          <a key={item.id} href={`#${item.id}`} className="docs-toc-link">
            {item.label}
          </a>
        ))}
      </nav>

      <div className="docs-content">
        {/* ================================================================
            PART 1: TUTORIAL — Workflow Guide
            ================================================================ */}

        {/* ====== SECTION 1: OVERVIEW ====== */}
        <div className="docs-section" id="overview">
          <h2 className="docs-heading">Ads Intelligence Overview</h2>
          <p>
            This page is the operating manual for generating Ghstly ad creatives using Claude Code skills. It covers the
            full lifecycle: coming up with new ideas, iterating on winners, deploying tests, and reading results.
          </p>
          <p>
            <strong>Who this is for:</strong> VAs managing ad creative production, and the founder (Claudio) when reviewing
            creative strategy. No coding knowledge required — you talk to Claude Code in plain English and it handles
            data pulls, analysis, and prompt generation.
          </p>
          <p>
            <strong>What you get out:</strong> JSON-structured prompts ready to paste into NB2 (Nano Banana 2, Google&apos;s
            Gemini image generator). NB2 produces 4K dark-mode iOS screenshots that look like real phone screens and
            blend into Instagram/Facebook feeds.
          </p>

          <h3 className="docs-subheading">The Three Skills</h3>
          <table className="docs-table">
            <thead>
              <tr>
                <th>Skill</th>
                <th>Codename</th>
                <th>Purpose</th>
                <th>When to Use</th>
                <th>Output</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code className="docs-code">/ad-performance-creative</code></td>
                <td><strong>EXPLORE</strong></td>
                <td>Invent genuinely new ad format categories</td>
                <td>Library feels stale, creative fatigue, need fresh ideas</td>
                <td>4-6 brand-new concept briefs + NB2 JSON prompts</td>
              </tr>
              <tr>
                <td><code className="docs-code">/ad-creative-iterations</code></td>
                <td><strong>EXPLOIT</strong></td>
                <td>Iterate on proven winners with single-variable A/B tests</td>
                <td>Have winners, want to squeeze more performance out of them</td>
                <td>2-3 variations per winner + A/B test plans</td>
              </tr>
              <tr>
                <td><code className="docs-code">/nb2-ad-creative</code></td>
                <td><strong>QUICK</strong></td>
                <td>Fast creatives from live 48-hour API data</td>
                <td>Need creatives now, want the freshest performance data</td>
                <td>2 concepts + 1 variation each + testing notes</td>
              </tr>
            </tbody>
          </table>

          <div className="docs-callout">
            <strong>Key difference:</strong> EXPLORE creates things you have never run before (new formats, new hooks, new UI patterns).
            EXPLOIT takes your best-performing ads and tests one change at a time to push them higher.
            QUICK is the fastest path when you just need creatives deployed today.
          </div>
        </div>

        {/* ====== SECTION 2: EXPLORE/EXPLOIT FRAMEWORK ====== */}
        <div className="docs-section" id="explore-exploit-framework">
          <h2 className="docs-heading">The Explore / Exploit Framework</h2>
          <p>
            Every ad account lives on a spectrum between two strategies. Understanding when to use each is the single
            most important thing in this document.
          </p>

          <h3 className="docs-subheading">The Cycle</h3>
          <pre className="docs-code">{`
  EXPLORE                                              EXPLOIT
  (new formats, untested ideas)                        (iterate winners, optimize)
  |                                                    |
  |  "What haven't we tried?"       "What's working?" |
  |                                                    |
  |  /ad-performance-creative        /ad-creative-     |
  |                                   iterations       |
  v                                                    v

  [NEW CONCEPT] ---> deploy $20-30 ---> WINS? ---> [WINNER]
       ^                                  |             |
       |                                  |             v
       |                              NO  |     Iterate with single-
       |                                  |     variable A/B tests
       +----------------------------------+             |
         (all iterations plateau                        |
          or < 5% improvement                           |
          over 3 rounds)                                v
                                                 Still improving?
                                                   YES -> keep exploiting
                                                   NO  -> back to explore
          `}</pre>

          <h3 className="docs-subheading">When to EXPLORE</h3>
          <ul>
            <li><strong>Creative fatigue detected:</strong> Your top ads show declining chat rates (down 30%+ from their average) or rising cost/reveal (up 50%+).</li>
            <li><strong>Format saturation:</strong> You have 6+ ads tested in a format category (e.g., 12 map ads). More of the same will not teach you anything new.</li>
            <li><strong>Stale library:</strong> You have not launched a genuinely new format in over 2 weeks.</li>
            <li><strong>All iterations plateau:</strong> Your last 3 rounds of EXPLOIT testing showed less than 5% improvement.</li>
            <li><strong>You just want fresh ideas:</strong> Sometimes you need creative energy, not optimization.</li>
          </ul>

          <h3 className="docs-subheading">When to EXPLOIT</h3>
          <ul>
            <li><strong>You have clear winners:</strong> At least one ad with chat rate above 25% and $5+ spend.</li>
            <li><strong>One name dominates:</strong> Sara is crushing it but you don&apos;t know if it&apos;s Sara or the format. Test Mia in the same format.</li>
            <li><strong>New format just won:</strong> An EXPLORE concept beat your top performer. Now iterate to find the optimal version.</li>
            <li><strong>Specific hypothesis:</strong> &quot;Would 850 ft perform better than 1,584 ft in the map format?&quot;</li>
          </ul>

          <div className="docs-callout">
            <strong>Rule of thumb:</strong> If you&apos;re not sure, check your Format Coverage Map. If any category has 6+ tested ads, you are
            saturated there — explore somewhere else. If your top performer has fewer than 3 variations tested, exploit it first.
          </div>
        </div>

        {/* ====== SECTION 3: WORKFLOW — EXPLORE ====== */}
        <div className="docs-section" id="workflow-explore">
          <h2 className="docs-heading">Workflow: Generating New Concepts (EXPLORE)</h2>
          <p>Use <code className="docs-code">/ad-performance-creative</code> when you want genuinely new ad formats.</p>

          <h3 className="docs-subheading">How to Trigger</h3>
          <p>Say any of these to Claude Code:</p>
          <ul>
            <li><code className="docs-code">&quot;Generate fresh ad concepts&quot;</code></li>
            <li><code className="docs-code">&quot;We need new ad formats, the current ones are getting stale&quot;</code></li>
            <li><code className="docs-code">&quot;What haven&apos;t we tried? Explore new creative directions&quot;</code></li>
            <li><code className="docs-code">&quot;Creative fatigue — give me something completely different&quot;</code></li>
          </ul>

          <h3 className="docs-subheading">What Happens (5 Phases)</h3>

          <div className="docs-step">
            <strong>Phase 1 — Data Pull &amp; Format Coverage Map</strong>
            <p>Queries 30 days of Supabase data. Categorizes every ad into format families and builds a Format Coverage Map showing saturation levels. Also runs creative fatigue detection (7-day vs 30-day metrics).</p>
          </div>

          <div className="docs-step">
            <strong>Phase 2 — External Research</strong>
            <p>Searches the web for: (1) competitor ad formats, (2) trending mobile UI patterns, (3) psychological hooks beyond proximity + urgency. Cached 36 hours.</p>
          </div>

          <div className="docs-step">
            <strong>Phase 3 — Gap Analysis &amp; Directions (CHECKPOINT)</strong>
            <p>Cross-references coverage map with research. Proposes 4-6 directions. Rules: at least 2 from untested categories, at least 1 with a new psychological hook, zero from saturated categories.</p>
          </div>

          <div className="docs-callout">
            <strong>CHECKPOINT:</strong> The skill pauses here. Review each direction. Approve all, pick specific ones, or ask for changes. It will not generate prompts until you confirm.
          </div>

          <div className="docs-step">
            <strong>Phase 4 — JSON Prompt Generation</strong>
            <p>For each approved direction: a paste-ready NB2 JSON prompt, ad copy (primary text + headline), hypothesis, target metrics, and kill thresholds.</p>
          </div>

          <div className="docs-step">
            <strong>Phase 5 — Summary</strong>
            <p>Table of all concepts with format, risk, expected metrics, and test budget.</p>
          </div>

          <h3 className="docs-subheading">After Generation</h3>
          <table className="docs-table">
            <thead>
              <tr><th>Step</th><th>Action</th><th>Details</th></tr>
            </thead>
            <tbody>
              <tr><td>1</td><td>Copy JSON prompt</td><td>Each concept has a JSON code block. Copy the entire block.</td></tr>
              <tr><td>2</td><td>Paste into NB2</td><td>Open Nano Banana 2. Paste the JSON as the prompt. Generate.</td></tr>
              <tr><td>3</td><td>Review image</td><td>Check: dark background, no device frame, text legible, branding visible.</td></tr>
              <tr><td>4</td><td>Deploy in Meta Ads</td><td>Upload as a new ad. Use the provided Primary Text and Headline.</td></tr>
              <tr><td>5</td><td>Budget: $20-30</td><td>Minimum spend for a directional signal (~500+ impressions).</td></tr>
              <tr><td>6</td><td>Wait 48 hours</td><td>Do not judge before 48h. Day/time variance skews early results.</td></tr>
            </tbody>
          </table>

          <h3 className="docs-subheading">Win / Loss</h3>
          <table className="docs-table">
            <thead><tr><th>Outcome</th><th>Condition</th><th>Next Step</th></tr></thead>
            <tbody>
              <tr><td><strong>WIN</strong></td><td>Chat rate &gt; median of top 5 OR cost/reveal &lt; 1.5x median (after $25+ spend)</td><td>Add format to creative guide. Run /ad-creative-iterations.</td></tr>
              <tr><td><strong>LOSS</strong></td><td>Neither threshold met after $30 spend</td><td>Pause. Log the learning. Move on.</td></tr>
            </tbody>
          </table>
        </div>

        {/* ====== SECTION 4: WORKFLOW — EXPLOIT ====== */}
        <div className="docs-section" id="workflow-exploit">
          <h2 className="docs-heading">Workflow: Iterating Winners (EXPLOIT)</h2>
          <p>Use <code className="docs-code">/ad-creative-iterations</code> when you have winners and want to optimize.</p>

          <h3 className="docs-subheading">How to Trigger</h3>
          <ul>
            <li><code className="docs-code">&quot;Iterate on our winning ads&quot;</code></li>
            <li><code className="docs-code">&quot;Create A/B variations of the top performers&quot;</code></li>
            <li><code className="docs-code">&quot;Test whether Mia outperforms Sara in the map format&quot;</code></li>
            <li><code className="docs-code">&quot;What variable should I change on map_walking_sara?&quot;</code></li>
          </ul>

          <h3 className="docs-subheading">What Happens (4 Phases)</h3>
          <div className="docs-step"><strong>Phase 1:</strong> Queries last 7 days from Supabase. Ranks top 3-5 by chat rate. Flags low-data winners (&lt;1,000 impressions).</div>
          <div className="docs-step"><strong>Phase 2 (CHECKPOINT):</strong> Decodes Creative DNA for each winner (format, hook, trigger, character, distance). Pauses for your approval.</div>
          <div className="docs-step"><strong>Phase 3:</strong> Generates 2-3 JSON variations per winner. Each changes exactly ONE variable.</div>
          <div className="docs-step"><strong>Phase 4:</strong> Summary table with testing order, total budget, and outcome interpretation.</div>

          <h3 className="docs-subheading">The Single-Variable Rule</h3>
          <div className="docs-callout">
            <strong>Most important rule:</strong> Each variation changes EXACTLY ONE conceptual variable. If you change two things and performance goes up, you don&apos;t know which caused it. The whole point is to learn something specific.
          </div>

          <h3 className="docs-subheading">Variables You Can Test</h3>
          <table className="docs-table">
            <thead><tr><th>Variable</th><th>What Changes</th><th>Example</th></tr></thead>
            <tbody>
              <tr><td><strong>Character swap</strong></td><td>Different girl name</td><td>Sara → Mia</td></tr>
              <tr><td><strong>Distance</strong></td><td>Different ft value</td><td>1,584 ft → 850 ft</td></tr>
              <tr><td><strong>Location</strong></td><td>Different California city</td><td>Hollywood → Santa Monica</td></tr>
              <tr><td><strong>Status</strong></td><td>Different indicator</td><td>&quot;online now&quot; → &quot;typing...&quot;</td></tr>
              <tr><td><strong>Time context</strong></td><td>Add/change time element</td><td>No time → &quot;2 min ago&quot;</td></tr>
              <tr><td><strong>Copy angle</strong></td><td>Different primary text</td><td>Proximity → anti-dating-app</td></tr>
              <tr><td><strong>Visual hook</strong></td><td>Different UI element</td><td>Typing dots → unread badge</td></tr>
            </tbody>
          </table>

          <h3 className="docs-subheading">Budget &amp; Thresholds</h3>
          <table className="docs-table">
            <thead><tr><th>Parameter</th><th>Value</th></tr></thead>
            <tbody>
              <tr><td>Budget per variation</td><td>$15-25</td></tr>
              <tr><td>Test duration</td><td>48h minimum (72h if still in Learning phase)</td></tr>
              <tr><td>Kill threshold</td><td>Cost/reveal &gt; 2x parent&apos;s cost/reveal</td></tr>
              <tr><td>Win condition</td><td>Chat rate &gt; parent by at least 5% OR cost/reveal &lt; parent by at least 10%. Smaller improvements at low spend are likely noise.</td></tr>
            </tbody>
          </table>

          <h3 className="docs-subheading">Reading Results</h3>
          <table className="docs-table">
            <thead><tr><th>Outcome</th><th>What It Means</th><th>Next Move</th></tr></thead>
            <tbody>
              <tr><td>Character swap wins</td><td>The format is the hero, not the name</td><td>Test more names. Scale the format.</td></tr>
              <tr><td>Character swap loses</td><td>The original name has magic</td><td>Keep name. Test other variables.</td></tr>
              <tr><td>Closer distance wins</td><td>Tighter proximity = more urgency</td><td>Push even closer next round.</td></tr>
              <tr><td>All iterations lose</td><td>Parent is locally optimal</td><td>Stop iterating. Switch to EXPLORE.</td></tr>
              <tr><td>&lt;5% improvement × 3 rounds</td><td>Diminishing returns</td><td>Stop iterating. Switch to EXPLORE.</td></tr>
            </tbody>
          </table>
        </div>

        {/* ====== SECTION 5: WORKFLOW — QUICK ====== */}
        <div className="docs-section" id="workflow-quick">
          <h2 className="docs-heading">Workflow: Quick Creatives</h2>
          <p>Use <code className="docs-code">/nb2-ad-creative</code> when you need ad creatives fast from live 48h data.</p>
          <table className="docs-table">
            <thead><tr><th>Aspect</th><th>QUICK</th><th>EXPLORE</th><th>EXPLOIT</th></tr></thead>
            <tbody>
              <tr><td>Data window</td><td>Last 48h (live API)</td><td>Last 30 days (Supabase)</td><td>Last 7 days (Supabase)</td></tr>
              <tr><td>Output</td><td>2 concepts + 1 variation each</td><td>4-6 new concepts</td><td>2-3 variations per winner</td></tr>
              <tr><td>Best for</td><td>Same-day turnaround</td><td>Strategic expansion</td><td>Disciplined optimization</td></tr>
            </tbody>
          </table>
          <div className="docs-callout">
            If a QUICK creative wins → hand it to EXPLOIT for proper iteration.
            If QUICK creatives keep losing → switch to EXPLORE for different formats.
          </div>
        </div>

        {/* ====== SECTION 6: TESTING CYCLE ====== */}
        <div className="docs-section" id="testing-cycle">
          <h2 className="docs-heading">The Testing Cycle</h2>

          <h3 className="docs-subheading">Decision Framework</h3>
          <table className="docs-table">
            <thead><tr><th>Result After 48h+</th><th>Decision</th><th>Action</th></tr></thead>
            <tbody>
              <tr><td>Beats top by &gt;20%</td><td><strong>SCALE</strong></td><td>+50% budget → 72h → horizontal scaling if holds</td></tr>
              <tr><td>Beats top by 5-20%</td><td><strong>ITERATE</strong></td><td>Keep running. Use /ad-creative-iterations.</td></tr>
              <tr><td>Within 5%</td><td><strong>KEEP</strong></td><td>Diversification value. One more iteration round.</td></tr>
              <tr><td>Below minimum thresholds</td><td><strong>KILL</strong></td><td>Pause. Log the learning.</td></tr>
              <tr><td>All recent creatives failing</td><td><strong>EXPLORE</strong></td><td>Current direction exhausted. Run /ad-performance-creative.</td></tr>
            </tbody>
          </table>

          <h3 className="docs-subheading">Scaling Winners</h3>
          <ol>
            <li>Win by &gt;20% → increase daily budget by 50%</li>
            <li>Performance holds at higher budget for 72h → duplicate adset for horizontal scaling</li>
            <li>Winner becomes new &quot;parent&quot; for next iteration round</li>
            <li>Update creative guide with the winning variable insight</li>
          </ol>
        </div>

        {/* ====== SECTION 7: COMMON MISTAKES ====== */}
        <div className="docs-section" id="common-mistakes">
          <h2 className="docs-heading">Common Mistakes</h2>
          <table className="docs-table">
            <thead><tr><th>Mistake</th><th>Why It&apos;s a Problem</th><th>Do This Instead</th></tr></thead>
            <tbody>
              <tr><td><strong>Changing multiple variables at once</strong></td><td>Can&apos;t attribute results to any single change</td><td>One conceptual variable per variation</td></tr>
              <tr><td><strong>White backgrounds or device mockups</strong></td><td>2-4x worse CTR</td><td>Dark/black backgrounds, edge-to-edge, no phone frames</td></tr>
              <tr><td><strong>Judging before 48 hours</strong></td><td>Day/time variance skews results</td><td>Wait 48h minimum (72h if Learning phase)</td></tr>
              <tr><td><strong>Iterating on low-data winners</strong></td><td>Optimizing for noise</td><td>Require 500+ impressions, $5+ spend</td></tr>
              <tr><td><strong>Prose prompts instead of JSON</strong></td><td>92% vs 68% precision</td><td>Always use JSON-structured prompts</td></tr>
              <tr><td><strong>Text over 25 characters</strong></td><td>Accuracy drops from ~94% to ~60%</td><td>Split across text_content and subject.description</td></tr>
              <tr><td><strong>Under $20 per concept test</strong></td><td>Not enough data for signal</td><td>$20-30 per new concept, $15-25 per variation</td></tr>
              <tr><td><strong>Skipping the checkpoint</strong></td><td>Generating unwanted directions</td><td>Always review before approving generation</td></tr>
              <tr><td><strong>Miles instead of feet</strong></td><td>&quot;0.3 mi&quot; feels distant; &quot;1,584 ft&quot; feels close</td><td>Always feet for distances under 0.5 miles</td></tr>
              <tr><td><strong>Hard-sell CTAs</strong></td><td>Breaks screenshot illusion</td><td>&quot;tap to chat&quot;, &quot;she&apos;s still online&quot;</td></tr>
            </tbody>
          </table>
        </div>

        {/* ================================================================
            PART 2: NB2 REFERENCE — JSON Schema & Creative Rules
            ================================================================ */}

        {/* ====== NB2 JSON FORMAT ====== */}
        <div className="docs-section" id="nb2-json-prompt-format">
          <h2 className="docs-heading">NB2 JSON Prompt Format</h2>
          <p>
            NB2 (Nano Banana 2) is Google Gemini&apos;s image generation model. All Ghstly creatives use
            <strong> JSON-structured prompts</strong> for 92% precision (vs 68% for prose), 40% faster generation, and 25-30% less memory.
          </p>

          <h3 className="docs-subheading">Base JSON Schema</h3>
          <pre className="docs-code json-block">{`{
  "meta": {
    "aspect_ratio": "9:16",
    "quality": "ultra_photorealistic",
    "seed": null,
    "steps": 50,
    "guidance_scale": 8.0
  },
  "subject": [{
    "id": "primary_ui",
    "type": "object",
    "description": "[Main UI element — the creative specificity lives here]"
  }],
  "scene": {
    "location": "[iOS dark mode interface / California location]",
    "time": "midnight",
    "lighting": { "type": "neon_lights", "direction": "front_lit" },
    "background_elements": ["[Status bar]", "[ghstly.chat branding]"]
  },
  "technical": {
    "camera_model": "iPhone 15 Pro",
    "lens": "24mm",
    "aperture": "f/1.8"
  },
  "composition": {
    "framing": "full_body",
    "angle": "eye_level",
    "focus_point": "whole_scene"
  },
  "text_rendering": {
    "enabled": true,
    "text_content": "[Name] · online now",
    "placement": "smart_phone_screen",
    "font_style": "bold_sans_serif",
    "color": "white with #FF9500 orange accent"
  },
  "style_modifiers": {
    "medium": "photography",
    "aesthetic": ["minimalist", "futuristic"]
  },
  "advanced": {
    "negative_prompt": ["...see canonical list below..."],
    "magic_prompt_enhancer": false,
    "hdr_mode": true
  }
}`}</pre>

          <h3 className="docs-subheading">Section Reference</h3>
          <table className="docs-table">
            <thead><tr><th>Section</th><th>Controls</th><th>Key Fields</th></tr></thead>
            <tbody>
              <tr><td><code>meta</code></td><td>Output dimensions, quality, reproducibility</td><td>aspect_ratio (9:16), quality (ultra_photorealistic), guidance_scale (8.0)</td></tr>
              <tr><td><code>subject</code></td><td>Primary visual element(s)</td><td>description (detailed UI layout — most creative specificity lives here)</td></tr>
              <tr><td><code>scene</code></td><td>Environment and context</td><td>location, time (midnight for dark), lighting, background_elements</td></tr>
              <tr><td><code>technical</code></td><td>Camera simulation</td><td>camera_model (iPhone 15 Pro), lens (24mm), aperture</td></tr>
              <tr><td><code>composition</code></td><td>Framing and focus</td><td>framing (full_body for full-screen), angle, focus_point</td></tr>
              <tr><td><code>text_rendering</code></td><td>On-screen text — critical for Ghstly ads</td><td>text_content (exact string), font_style (bold_sans_serif), color</td></tr>
              <tr><td><code>style_modifiers</code></td><td>Overall aesthetic</td><td>medium (photography), aesthetic array</td></tr>
              <tr><td><code>advanced</code></td><td>Negative prompts, HDR, enhancer toggle</td><td>negative_prompt (14-item list), magic_prompt_enhancer (always false)</td></tr>
            </tbody>
          </table>
        </div>

        {/* ====== CREATIVE RULES ====== */}
        <div className="docs-section" id="ghstly-creative-rules">
          <h2 className="docs-heading">Ghstly Creative Rules (Non-Negotiable)</h2>
          <p>These 9 rules override everything. The core principle: the best Ghstly ads are indistinguishable from real phone screenshots. Anything &quot;designed&quot; or &quot;ad-like&quot; gets <strong>2-4x worse CTR</strong>.</p>
          <table className="docs-table">
            <thead><tr><th>#</th><th>Rule</th><th>Why</th></tr></thead>
            <tbody>
              <tr><td>1</td><td><strong>Edge-to-edge screen content</strong> — no bezels, no device frames, no phone body</td><td>Viewer must think this is their own screen</td></tr>
              <tr><td>2</td><td><strong>No white backgrounds</strong> — dark/black only (#000, #0A0A0A)</td><td>White screams &quot;ad&quot; and clashes with dark-mode feeds</td></tr>
              <tr><td>3</td><td><strong>No device mockups</strong> — no phones on surfaces, no product shots</td><td>Mockups are app-store marketing, not native content</td></tr>
              <tr><td>4</td><td><strong>9:16 at 4K</strong> — 3072×5504 from NB2</td><td>Native Reels/Story ratio, anything else gets cropped</td></tr>
              <tr><td>5</td><td><strong>Reels safe zone</strong> — critical content in top 65-70%</td><td>Bottom 30% covered by Reels UI</td></tr>
              <tr><td>6</td><td><strong>Distances in feet</strong> — &quot;1,584 ft&quot; not &quot;0.3 mi&quot;</td><td>Feet create intimacy and specificity</td></tr>
              <tr><td>7</td><td><strong>California locations</strong> — Hollywood, WeHo, Beverly Hills, Santa Monica, Venice, DTLA, Long Beach, Silver Lake, Echo Park</td><td>Desirability + nightlife associations</td></tr>
              <tr><td>8</td><td><strong>Named girls with status</strong> — &quot;Sara · online now&quot;</td><td>Names create personal connection, status creates urgency</td></tr>
              <tr><td>9</td><td><strong>Visible Ghstly branding</strong> — logo or &quot;ghstly.chat&quot; text</td><td>Meta compliance + brand recall</td></tr>
            </tbody>
          </table>
          <div className="docs-callout">
            <strong>Visual identity:</strong> Background: #000 or #0A0A0A. Accent: orange #FF9500–#FF7700. Typography: system fonts (SF Pro). Aesthetic: mobile-native, screenshot-realistic, anti-polish.
          </div>
        </div>

        {/* ====== FORMAT CATEGORIES ====== */}
        <div className="docs-section" id="format-categories">
          <h2 className="docs-heading">Format Categories (Tiers 1-5)</h2>
          <p>44+ tested concepts across 5 tiers. Tiers 1-2 are most tested; Tiers 4-5 are undertested opportunities.</p>

          <h3 className="docs-subheading">Tier 1 — Map / Navigation (Highest CTR)</h3>
          <p>Gold standard. Sara Apple Maps: 10-17% CTR and $0.20-0.28 CPC.</p>
          <ul><li>Uber-style approach maps with ETA</li><li>Apple Maps walking directions with distance</li><li>Satellite view with typing bubbles</li><li>Multi-pin maps with chat preview bubbles</li></ul>

          <h3 className="docs-subheading">Tier 2 — Lock Screen / Notification</h3>
          <p>Strong native feel. Well-tested.</p>
          <ul><li>Single rich notification with map thumbnail</li><li>Notification center with proximity gradient</li><li>Dynamic Island with distance countdown</li><li>Contact Poster incoming chat</li></ul>

          <h3 className="docs-subheading">Tier 3 — Chat / Message UI</h3>
          <p>Moderately tested. Room for exploration.</p>
          <ul><li>iMessage empty chat with typing indicator</li><li>Stale conversations contrast</li><li>IG Close Friends story notification</li></ul>

          <h3 className="docs-subheading">Tier 4 — System UI Mimicry (Undertested)</h3>
          <p>High creative potential — surprises the viewer.</p>
          <ul><li>Low Battery popup with Ghstly notification</li><li>Screen Time report (Communication 0h vs Instagram 12h)</li><li>Calendar empty Saturday with suggested event</li><li>Spotlight Search with Ghstly as Siri Suggestion</li><li>Safari autocomplete showing ghstly.chat</li></ul>

          <h3 className="docs-subheading">Tier 5 — Split Screen / Comparison (Undertested)</h3>
          <ul><li>&quot;Your phone rn&quot; vs &quot;Your phone on Ghstly&quot;</li><li>Tinder miles vs Ghstly feet comparison</li></ul>
        </div>

        {/* ====== NEGATIVE PROMPTS ====== */}
        <div className="docs-section" id="canonical-negative-prompt-list">
          <h2 className="docs-heading">Canonical Negative Prompt List</h2>
          <p>These 14 items must be in every prompt&apos;s <code>advanced.negative_prompt</code> array. They combat the &quot;AI look.&quot;</p>
          <pre className="docs-code json-block">{`"negative_prompt": [
  "white background",
  "device frame",
  "phone bezels",
  "phone body",
  "hands holding phone",
  "phone on desk",
  "product mockup",
  "plastic skin",
  "smoothing",
  "beautification filters",
  "anatomy normalization",
  "marketing layout",
  "ad template",
  "stock photo aesthetic"
]`}</pre>
        </div>

        {/* ====== TEXT RENDERING ====== */}
        <div className="docs-section" id="text-rendering-tips">
          <h2 className="docs-heading">Text Rendering Tips</h2>
          <ol>
            <li><strong>25-character limit</strong> per text element. Accuracy drops from ~94% to ~60% above 25 chars.</li>
            <li><strong>Double-quote exact strings</strong> in <code>text_content</code>.</li>
            <li><strong>Two-step method</strong> for critical text: generate text first, then full image.</li>
            <li><strong>Specify font explicitly</strong>: <code>bold_sans_serif</code> for iOS system text.</li>
            <li><strong>Set <code>magic_prompt_enhancer: false</code></strong> — prevents NB2 from rewriting your text.</li>
          </ol>
          <p><strong>Multiple text elements:</strong> Put primary text in <code>text_rendering.text_content</code>. Embed secondary strings in <code>subject.description</code> with explicit rendering instructions.</p>
        </div>

        {/* ====== AD COPY ====== */}
        <div className="docs-section" id="ad-copy-patterns">
          <h2 className="docs-heading">Ad Copy Patterns</h2>
          <table className="docs-table">
            <thead><tr><th>Field</th><th>Limit</th><th>Style</th></tr></thead>
            <tbody>
              <tr><td>Primary Text</td><td>&lt;125 chars</td><td>Proximity/curiosity lead. Conversational. &quot;847 ft away. She&apos;s still online.&quot;</td></tr>
              <tr><td>Headline</td><td>&lt;40 chars</td><td>Soft action. &quot;tap to chat&quot;, &quot;open ghstly.chat&quot;</td></tr>
            </tbody>
          </table>
          <p><strong>What works:</strong> Specific distances (&quot;1,247 ft&quot;), named girls (&quot;Sara just went online&quot;), time pressure (&quot;still online&quot;, &quot;2 min ago&quot;), anti-dating-app positioning (&quot;no profile needed&quot;).</p>
          <p><strong>What to avoid:</strong> Hard sells, generic marketing language, formal tone, overpromising.</p>
        </div>

        {/* ====== BENCHMARKS ====== */}
        <div className="docs-section" id="performance-benchmarks">
          <h2 className="docs-heading">Performance Benchmarks</h2>
          <p>Three metrics are tiered: <strong>chat rate</strong>, <strong>cost per chat</strong>, and <strong>reveal rate</strong>. Each ad is evaluated on all three independently — the composite tier equals the worst rating across them. Thresholds are defined in <code className="docs-code">tier-classifier.ts</code> and used by the Intelligence page.</p>

          <h3 className="docs-subheading">Chat Rate Tiers</h3>
          <table className="docs-table">
            <thead><tr><th>Tier</th><th>Chat Rate</th><th>Action</th></tr></thead>
            <tbody>
              <tr><td><span className="tier-badge tier-perfect">Perfect</span></td><td>&ge;85%</td><td>Scale aggressively</td></tr>
              <tr><td><span className="tier-badge tier-really-good">Really Good</span></td><td>80–84%</td><td>Scale</td></tr>
              <tr><td><span className="tier-badge tier-good">Good</span></td><td>75–79%</td><td>Maintain</td></tr>
              <tr><td><span className="tier-badge tier-okay">Okay</span></td><td>65–74%</td><td>Maintain</td></tr>
              <tr><td><span className="tier-badge tier-below">Below Target</span></td><td>50–64%</td><td>Monitor</td></tr>
              <tr><td><span className="tier-badge tier-poor">Poor</span></td><td>40–49%</td><td>Flag for review</td></tr>
              <tr><td><span className="tier-badge tier-critical">Critical</span></td><td>&lt;40%</td><td>Disband</td></tr>
            </tbody>
          </table>

          <h3 className="docs-subheading">Cost per Chat Tiers</h3>
          <table className="docs-table">
            <thead><tr><th>Tier</th><th>Cost / Chat</th><th>Action</th></tr></thead>
            <tbody>
              <tr><td><span className="tier-badge tier-perfect">Perfect</span></td><td>&le;$0.20</td><td>Scale aggressively</td></tr>
              <tr><td><span className="tier-badge tier-really-good">Very Good</span></td><td>$0.21–$0.30</td><td>Scale</td></tr>
              <tr><td><span className="tier-badge tier-okay">Good-Okay</span></td><td>$0.31–$0.40</td><td>Maintain</td></tr>
              <tr><td><span className="tier-badge tier-below">Below Target</span></td><td>$0.41–$0.50</td><td>Monitor</td></tr>
              <tr><td><span className="tier-badge tier-poor">Poor</span></td><td>$0.51–$0.60</td><td>Flag for review</td></tr>
              <tr><td><span className="tier-badge tier-critical">Critical</span></td><td>&gt;$0.60</td><td>Disband</td></tr>
            </tbody>
          </table>

          <h3 className="docs-subheading">Reveal Rate Tiers</h3>
          <table className="docs-table">
            <thead><tr><th>Tier</th><th>Reveal Rate</th><th>Action</th></tr></thead>
            <tbody>
              <tr><td><span className="tier-badge tier-perfect">Perfect</span></td><td>&ge;40%</td><td>Scale aggressively</td></tr>
              <tr><td><span className="tier-badge tier-really-good">Great</span></td><td>35–39%</td><td>Scale</td></tr>
              <tr><td><span className="tier-badge tier-good">Good</span></td><td>30–34%</td><td>Maintain</td></tr>
              <tr><td><span className="tier-badge tier-okay">Okay</span></td><td>25–29%</td><td>Maintain</td></tr>
              <tr><td><span className="tier-badge tier-below">Below Target</span></td><td>20–24%</td><td>Flag for review</td></tr>
              <tr><td><span className="tier-badge tier-critical">Critical</span></td><td>&lt;20%</td><td>Disband</td></tr>
            </tbody>
          </table>

          <div className="docs-callout">
            <strong>How tiering works:</strong> Each ad is evaluated on all three metrics independently. The composite tier equals the <em>worst</em> rating across chat rate, cost/chat, and reveal rate. An ad with Perfect chat rate but Critical cost/chat gets a Critical composite tier.
          </div>
          <div className="docs-callout">
            <strong>Suppression:</strong> Entities with fewer than 50 visits get &quot;Insufficient Data&quot; instead of a tier. Tiers are also suppressed when data freshness is degraded or stale.
          </div>
          <div className="docs-callout">
            <strong>Note on CTR and Cost/Reveal:</strong> These metrics appear in the scorecard but are NOT part of the tier classification system. They are useful reference metrics but do not affect an ad&apos;s tier or recommended action.
          </div>
        </div>

      </div>
    </section>
  );
}
