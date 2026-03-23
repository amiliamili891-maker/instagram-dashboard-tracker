import { describe, it, expect } from 'vitest';
import {
  inferAttributesFromName,
  analyzeFormatCoverage,
  FORMAT_CATEGORIES,
  FORMAT_LABELS,
  EMOTIONAL_TRIGGERS,
  TRIGGER_LABELS,
  TEXT_ANGLES,
  ANGLE_LABELS,
} from './creative-attributes';

// ---------------------------------------------------------------------------
// Taxonomy completeness
// ---------------------------------------------------------------------------

describe('taxonomy completeness', () => {
  it('every FORMAT_CATEGORY has a label', () => {
    for (const cat of FORMAT_CATEGORIES) {
      expect(FORMAT_LABELS[cat]).toBeDefined();
      expect(typeof FORMAT_LABELS[cat]).toBe('string');
    }
  });

  it('every EMOTIONAL_TRIGGER has a label', () => {
    for (const trigger of EMOTIONAL_TRIGGERS) {
      expect(TRIGGER_LABELS[trigger]).toBeDefined();
    }
  });

  it('every TEXT_ANGLE has a label', () => {
    for (const angle of TEXT_ANGLES) {
      expect(ANGLE_LABELS[angle]).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// inferAttributesFromName — format detection
// ---------------------------------------------------------------------------

describe('inferAttributesFromName — format', () => {
  const cases: [string, string | null][] = [
    // Ghost pin / Maps
    ['apple_maps_sara_silverlake', 'ghostpin'],
    ['C01_ghostpin_sara_847ft_0323', 'ghostpin'],
    ['maps_walking_mia_venice', 'ghostpin'],

    // Find My
    ['find_my_people_multipin', 'findmy'],
    ['findmy_lily_test_native', 'findmy'],

    // Dynamic Island
    ['dynamic_island_mia_venice', 'dynamic_island'],
    ['dynamicisland_emma_silverlake', 'dynamic_island'],
    ['live_activity_approaching', 'dynamic_island'],

    // Chat / iMessage
    ['imessage_typing_indicator', 'chat'],
    ['chat_bubble_sara_412ft', 'chat'],
    ['typing_dots_anonymous', 'chat'],

    // Notification
    ['notification_stack_3msgs', 'notification'],
    ['lock_screen_alert_ghstly', 'notification'],

    // Music
    ['apple_music_also_listening', 'music'],
    ['spotify_nearby_listener', 'music'],

    // Search
    ['safari_autocomplete_ghstly', 'search'],
    ['google_search_near_me', 'search'],

    // Social Story
    ['ig_story_bro_what', 'social_story'],
    ['close_friends_added_you', 'social_story'],

    // Comparison
    ['tinder_vs_ghstly_distance', 'comparison'],

    // System UI
    ['low_battery_popup_mia', 'system_ui'],
    ['screen_time_report_ghstly', 'system_ui'],
    ['calendar_empty_saturday', 'system_ui'],
    ['alarm_good_morning', 'system_ui'],

    // Camera
    ['camera_night_mode_silhouette', 'camera'],

    // CarPlay
    ['carplay_driving_home_hollywood', 'carplay'],

    // Widget
    ['widget_homescreen_sara', 'widget'],

    // Rideshare
    ['uber_map_approaching_sunset', 'rideshare'],

    // Timeline
    ['timeline_missed_connection', 'timeline'],

    // UGC
    ['ugc_screenshot_chat', 'ugc_screenshot'],
    ['bro_check_this_app', 'ugc_screenshot'],

    // Generic — no match
    ['AF_Ghstly_CMP0005_Set1_Ad1', null],
  ];

  it.each(cases)('"%s" → %s', (name, expected) => {
    const result = inferAttributesFromName(name);
    expect(result.format_category).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// inferAttributesFromName — trigger detection
// ---------------------------------------------------------------------------

describe('inferAttributesFromName — trigger', () => {
  const cases: [string, string | null][] = [
    ['sara_nearby_847ft', 'proximity'],
    ['walking_approaching_mia', 'proximity'],
    ['she_messaged_first_sara', 'inbound'],
    ['sent_you_message_ava', 'inbound'],
    ['friend_shared_ghstly', 'social_proof'],
    ['bro_check_this', 'social_proof'],
    ['tinder_burnout_swipe', 'dating_burnout'],
    ['cant_sleep_late_night', 'loneliness'],
    ['battery_dying_urgent', 'urgency'],
    ['omegle_remember_random', 'nostalgia'],
    ['missed_connection_were_near', 'regret'],
    ['screen_time_identity', 'identity'],
    ['AF_Ghstly_CMP0005_Set1_Ad1', null],
  ];

  it.each(cases)('"%s" → %s', (name, expected) => {
    const result = inferAttributesFromName(name);
    expect(result.emotional_trigger).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// inferAttributesFromName — angle detection
// ---------------------------------------------------------------------------

describe('inferAttributesFromName — angle', () => {
  const cases: [string, string | null][] = [
    ['sara_847_ft_away', 'nearby'],
    ['nearby_distance_walking', 'nearby'],
    ['she_messaged_first', 'she_messaged'],
    ['anonymous_no_one_knows', 'no_one_knows'],
    ['friend_shared_app', 'friend_shared'],
    ['tinder_no_matching', 'anti_dating_app'],
    ['typing_online_now', 'right_now'],
    ['missed_connection_sara', 'missed_it'],
    ['cant_sleep_1am', 'cant_sleep'],
    ['screen_time_scroll', 'wasted_time'],
    ['morning_alarm_good_morning', 'good_morning'],
    ['AF_Ghstly_CMP0005_Set1_Ad1', null],
  ];

  it.each(cases)('"%s" → %s', (name, expected) => {
    const result = inferAttributesFromName(name);
    expect(result.text_angle).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// analyzeFormatCoverage
// ---------------------------------------------------------------------------

describe('analyzeFormatCoverage', () => {
  it('returns all categories except "other"', () => {
    const coverage = analyzeFormatCoverage([]);
    const categories = coverage.map(c => c.category);
    expect(categories).not.toContain('other');
    // All non-other categories should be present
    expect(categories.length).toBe(FORMAT_CATEGORIES.length - 1);
  });

  it('marks empty categories as untested', () => {
    const coverage = analyzeFormatCoverage([]);
    for (const c of coverage) {
      expect(c.saturation).toBe('untested');
      expect(c.count).toBe(0);
    }
  });

  it('classifies saturation levels correctly', () => {
    const ads = [
      // 6 ghostpin ads → saturated
      ...Array(6).fill({ format_category: 'ghostpin' }),
      // 4 notification ads → moderate
      ...Array(4).fill({ format_category: 'notification' }),
      // 1 chat ad → light
      { format_category: 'chat' },
      // 0 findmy → untested
    ];

    const coverage = analyzeFormatCoverage(ads);

    const ghostpin = coverage.find(c => c.category === 'ghostpin')!;
    expect(ghostpin.count).toBe(6);
    expect(ghostpin.saturation).toBe('saturated');

    const notification = coverage.find(c => c.category === 'notification')!;
    expect(notification.count).toBe(4);
    expect(notification.saturation).toBe('moderate');

    const chat = coverage.find(c => c.category === 'chat')!;
    expect(chat.count).toBe(1);
    expect(chat.saturation).toBe('light');

    const findmy = coverage.find(c => c.category === 'findmy')!;
    expect(findmy.count).toBe(0);
    expect(findmy.saturation).toBe('untested');
  });

  it('ignores null format_category', () => {
    const ads = [
      { format_category: null },
      { format_category: 'ghostpin' },
    ];
    const coverage = analyzeFormatCoverage(ads);
    const ghostpin = coverage.find(c => c.category === 'ghostpin')!;
    expect(ghostpin.count).toBe(1);
  });

  it('ignores unknown format_category values', () => {
    const ads = [
      { format_category: 'nonexistent_format' },
    ];
    const coverage = analyzeFormatCoverage(ads);
    // All should still be untested
    for (const c of coverage) {
      expect(c.count).toBe(0);
    }
  });
});
