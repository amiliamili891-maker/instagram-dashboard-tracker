/**
 * Creative attribute taxonomy for ad performance analysis.
 *
 * Every ad gets tagged with three attributes:
 *   - format_category: the visual format family (what does the ad look like?)
 *   - emotional_trigger: the primary psychological trigger (why does someone click?)
 *   - text_angle: the primary copy angle (what does the text communicate?)
 *
 * These enable performance analysis by attribute rather than individual ad,
 * answering questions like "do map formats outperform notification formats?"
 */

// ---------------------------------------------------------------------------
// Format Categories
// ---------------------------------------------------------------------------

export const FORMAT_CATEGORIES = [
  'ghostpin',         // Apple Maps ghost pin (Sara, 847 ft)
  'findmy',           // Find My People / multi-pin
  'notification',     // Lock screen notification stack
  'chat',             // iMessage / chat bubble / typing indicator
  'airdrop',          // AirDrop receive prompt
  'rideshare',        // Uber/Lyft map with approaching pin
  'music',            // Apple Music / Spotify "also listening"
  'search',           // Google Search / Safari autocomplete
  'social_story',     // Instagram Story / Close Friends screenshot
  'comparison',       // Tinder vs Ghstly split-screen
  'system_ui',        // Battery popup, Screen Time, Calendar, Health
  'camera',           // Camera viewfinder / night mode
  'carplay',          // CarPlay navigation
  'dynamic_island',   // Dynamic Island / Live Activity
  'widget',           // Home screen widget
  'timeline',         // Maps timeline / missed connection
  'ugc_screenshot',   // UGC-style screenshot of Ghstly chat shared on social
  'other',            // Unclassified
] as const;

export type FormatCategory = typeof FORMAT_CATEGORIES[number];

export const FORMAT_LABELS: Record<FormatCategory, string> = {
  ghostpin: 'Ghost Pin (Maps)',
  findmy: 'Find My People',
  notification: 'Notification Stack',
  chat: 'Chat / iMessage',
  airdrop: 'AirDrop',
  rideshare: 'Rideshare Map',
  music: 'Music (Apple/Spotify)',
  search: 'Search / Autocomplete',
  social_story: 'Social Story',
  comparison: 'Comparison Split',
  system_ui: 'System UI',
  camera: 'Camera Viewfinder',
  carplay: 'CarPlay',
  dynamic_island: 'Dynamic Island',
  widget: 'Widget',
  timeline: 'Timeline / Missed',
  ugc_screenshot: 'UGC Screenshot',
  other: 'Other',
};

// ---------------------------------------------------------------------------
// Emotional Triggers
// ---------------------------------------------------------------------------

export const EMOTIONAL_TRIGGERS = [
  'proximity',        // She's right here (847 ft)
  'inbound',          // She noticed/messaged you first
  'social_proof',     // Your friend uses this / peer endorsement
  'scarcity',         // Others chatting with her / limited
  'anonymity',        // No one has to know
  'fomo',             // Happening right now without you
  'identity',         // You're the guy who... / identity confrontation
  'curiosity',        // What is this? / pattern interrupt
  'urgency',          // Battery dying / time running out
  'nostalgia',        // Remember Omegle? / pre-algorithm internet
  'loneliness',       // Empty apartment / no one to text
  'dating_burnout',   // Tired of swiping / anti-Tinder
  'regret',           // You were right there and didn't know
] as const;

export type EmotionalTrigger = typeof EMOTIONAL_TRIGGERS[number];

export const TRIGGER_LABELS: Record<EmotionalTrigger, string> = {
  proximity: 'Proximity',
  inbound: 'Inbound Interest',
  social_proof: 'Social Proof',
  scarcity: 'Scarcity',
  anonymity: 'Anonymity',
  fomo: 'FOMO',
  identity: 'Identity',
  curiosity: 'Curiosity',
  urgency: 'Urgency',
  nostalgia: 'Nostalgia',
  loneliness: 'Loneliness',
  dating_burnout: 'Dating Burnout',
  regret: 'Regret',
};

// ---------------------------------------------------------------------------
// Text Angles
// ---------------------------------------------------------------------------

export const TEXT_ANGLES = [
  'nearby',           // "847 ft away" / distance-first
  'she_messaged',     // "Sara sent you a message"
  'no_one_knows',     // Anonymity-first copy
  'friend_shared',    // "bro check this app"
  'anti_dating_app',  // "No swiping. No matching."
  'right_now',        // "Someone nearby is typing..."
  'missed_it',        // "You were 200 ft from Sara"
  'cant_sleep',       // "Can't sleep? Neither can she."
  'wasted_time',      // Screen time / you're scrolling anyway
  'just_talk',        // "Just talking. No profile needed."
  'she_is_real',      // "this can't be real" / authenticity
  'good_morning',     // Morning notification / woke up nearby
  'other',            // Unclassified
] as const;

export type TextAngle = typeof TEXT_ANGLES[number];

export const ANGLE_LABELS: Record<TextAngle, string> = {
  nearby: 'Nearby / Distance',
  she_messaged: 'She Messaged First',
  no_one_knows: 'Anonymity',
  friend_shared: 'Friend Shared',
  anti_dating_app: 'Anti-Dating App',
  right_now: 'Right Now / Live',
  missed_it: 'Missed Connection',
  cant_sleep: 'Late Night',
  wasted_time: 'Wasted Time',
  just_talk: 'Just Talk',
  she_is_real: 'She Is Real',
  good_morning: 'Good Morning',
  other: 'Other',
};

// ---------------------------------------------------------------------------
// Ad Attributes Interface
// ---------------------------------------------------------------------------

export interface AdCreativeAttributes {
  format_category: FormatCategory | null;
  emotional_trigger: EmotionalTrigger | null;
  text_angle: TextAngle | null;
}

// ---------------------------------------------------------------------------
// Name-Based Classification
// ---------------------------------------------------------------------------

/**
 * Infer creative attributes from an ad name.
 *
 * Ad names follow patterns like:
 *   "AF_Ghstly_CMP0011_Set1_Ad1" (generic)
 *   "C12_ghostpin_sara_847ft_0324" (structured)
 *   "apple_maps_sara_silverlake" (descriptive)
 *
 * This function uses keyword matching to tag ads that don't have manual tags.
 * Returns null for any attribute it can't confidently infer.
 */
export function inferAttributesFromName(name: string): AdCreativeAttributes {
  const lower = name.toLowerCase();

  return {
    format_category: inferFormat(lower),
    emotional_trigger: inferTrigger(lower),
    text_angle: inferAngle(lower),
  };
}

function inferFormat(name: string): FormatCategory | null {
  // Order matters — more specific patterns first
  if (name.includes('dynamic_island') || name.includes('dynamicisland') || name.includes('live_activity')) return 'dynamic_island';
  if (name.includes('carplay')) return 'carplay';
  if (name.includes('widget') || name.includes('homescreen')) return 'widget';
  if (name.includes('airdrop')) return 'airdrop';
  if (name.includes('find_my') || name.includes('findmy') || name.includes('find my')) return 'findmy';
  if (name.includes('ghost_pin') || name.includes('ghostpin') || name.includes('apple_map') || name.includes('maps_')) return 'ghostpin';
  if (name.includes('uber') || name.includes('lyft') || name.includes('rideshare')) return 'rideshare';
  if (name.includes('imessage') || name.includes('typing') || name.includes('chat_bubble') || name.includes('message_')) return 'chat';
  if (name.includes('notification') || name.includes('notif_') || name.includes('lock_screen') || name.includes('lockscreen')) return 'notification';
  if (name.includes('music') || name.includes('spotify') || name.includes('apple_music')) return 'music';
  if (name.includes('search') || name.includes('safari') || name.includes('google_') || name.includes('autocomplete')) return 'search';
  if (name.includes('story') || name.includes('close_friends') || name.includes('ig_')) return 'social_story';
  if (name.includes('tinder') || name.includes('vs_') || name.includes('comparison')) return 'comparison';
  if (name.includes('battery') || name.includes('screen_time') || name.includes('calendar') || name.includes('health') || name.includes('alarm')) return 'system_ui';
  if (name.includes('camera') || name.includes('night_mode') || name.includes('viewfinder')) return 'camera';
  if (name.includes('timeline') || name.includes('missed')) return 'timeline';
  if (name.includes('ugc') || name.includes('screenshot') || name.includes('bro_')) return 'ugc_screenshot';
  return null;
}

function inferTrigger(name: string): EmotionalTrigger | null {
  if (name.includes('nearby') || name.includes('_ft') || name.includes('walking') || name.includes('approaching')) return 'proximity';
  if (name.includes('messaged') || name.includes('sent_you') || name.includes('she_first')) return 'inbound';
  if (name.includes('friend') || name.includes('bro') || name.includes('shared')) return 'social_proof';
  if (name.includes('others_') || name.includes('3_people') || name.includes('waitlist')) return 'scarcity';
  if (name.includes('anonymous') || name.includes('no_one_knows')) return 'anonymity';
  if (name.includes('fomo') || name.includes('right_now') || name.includes('happening')) return 'fomo';
  if (name.includes('burnout') || name.includes('tinder') || name.includes('swip')) return 'dating_burnout';
  if (name.includes('cant_sleep') || name.includes('insomnia') || name.includes('late_night') || name.includes('lonely') || name.includes('empty')) return 'loneliness';
  if (name.includes('battery') || name.includes('dying') || name.includes('urgent')) return 'urgency';
  if (name.includes('omegle') || name.includes('remember')) return 'nostalgia';
  if (name.includes('missed') || name.includes('were_near')) return 'regret';
  if (name.includes('screen_time') || name.includes('identity')) return 'identity';
  return null;
}

function inferAngle(name: string): TextAngle | null {
  if (name.includes('_ft') || name.includes('nearby') || name.includes('distance') || name.includes('walking')) return 'nearby';
  if (name.includes('messaged') || name.includes('sent_you') || name.includes('she_first')) return 'she_messaged';
  if (name.includes('anonymous') || name.includes('no_one')) return 'no_one_knows';
  if (name.includes('friend') || name.includes('bro')) return 'friend_shared';
  if (name.includes('tinder') || name.includes('swip') || name.includes('no_matching')) return 'anti_dating_app';
  if (name.includes('typing') || name.includes('online_now') || name.includes('right_now')) return 'right_now';
  if (name.includes('missed') || name.includes('were_near')) return 'missed_it';
  if (name.includes('cant_sleep') || name.includes('insomnia') || name.includes('1am')) return 'cant_sleep';
  if (name.includes('screen_time') || name.includes('scroll')) return 'wasted_time';
  if (name.includes('just_talk') || name.includes('no_profile')) return 'just_talk';
  if (name.includes('real') || name.includes('ugc') || name.includes('cant_be')) return 'she_is_real';
  if (name.includes('morning') || name.includes('alarm') || name.includes('good_morning')) return 'good_morning';
  return null;
}

// ---------------------------------------------------------------------------
// Format Coverage Analysis
// ---------------------------------------------------------------------------

export interface FormatCoverage {
  category: FormatCategory;
  label: string;
  count: number;
  saturation: 'saturated' | 'moderate' | 'light' | 'untested';
}

/**
 * Analyze format coverage from a list of ads.
 * Returns all format categories with their ad count and saturation level.
 */
export function analyzeFormatCoverage(
  ads: Array<{ format_category: string | null }>
): FormatCoverage[] {
  const counts = new Map<FormatCategory, number>();

  // Initialize all categories to 0
  for (const cat of FORMAT_CATEGORIES) {
    counts.set(cat, 0);
  }

  // Count ads per category
  for (const ad of ads) {
    if (ad.format_category && counts.has(ad.format_category as FormatCategory)) {
      counts.set(ad.format_category as FormatCategory, counts.get(ad.format_category as FormatCategory)! + 1);
    }
  }

  return FORMAT_CATEGORIES
    .filter(cat => cat !== 'other')
    .map(cat => {
      const count = counts.get(cat) ?? 0;
      let saturation: FormatCoverage['saturation'];
      if (count >= 6) saturation = 'saturated';
      else if (count >= 3) saturation = 'moderate';
      else if (count >= 1) saturation = 'light';
      else saturation = 'untested';

      return {
        category: cat,
        label: FORMAT_LABELS[cat],
        count,
        saturation,
      };
    });
}
