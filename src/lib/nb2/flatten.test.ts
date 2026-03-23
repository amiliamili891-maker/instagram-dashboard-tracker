import { describe, it, expect } from 'vitest';
import { flattenNb2Prompt, isNb2Json } from './flatten';
import type { Nb2Prompt } from './types';

// ---------------------------------------------------------------------------
// flattenNb2Prompt
// ---------------------------------------------------------------------------

describe('flattenNb2Prompt', () => {
  it('includes subject descriptions', () => {
    const prompt: Nb2Prompt = {
      subject: [{ description: 'A glowing phone screen in the dark' }],
    };
    const result = flattenNb2Prompt(prompt);
    expect(result).toContain('A glowing phone screen in the dark');
  });

  it('includes multiple subjects', () => {
    const prompt: Nb2Prompt = {
      subject: [
        { description: 'First subject description' },
        { description: 'Second subject description' },
      ],
    };
    const result = flattenNb2Prompt(prompt);
    expect(result).toContain('First subject description');
    expect(result).toContain('Second subject description');
  });

  it('includes scene location and time', () => {
    const prompt: Nb2Prompt = {
      subject: [{ description: 'A phone' }],
      scene: {
        location: 'Echo Park California',
        time: 'early morning 7 AM',
      },
    };
    const result = flattenNb2Prompt(prompt);
    expect(result).toContain('Echo Park California');
    expect(result).toContain('early morning 7 AM');
  });

  it('includes lighting info', () => {
    const prompt: Nb2Prompt = {
      subject: [{ description: 'A phone' }],
      scene: {
        lighting: {
          type: 'ambient screen glow',
          direction: 'front_lit',
        },
      },
    };
    const result = flattenNb2Prompt(prompt);
    expect(result).toContain('ambient screen glow');
    expect(result).toContain('front_lit');
  });

  it('includes background elements', () => {
    const prompt: Nb2Prompt = {
      subject: [{ description: 'A phone' }],
      scene: {
        background_elements: ['iOS status bar: 7:00 AM', 'Stacked overnight notifications'],
      },
    };
    const result = flattenNb2Prompt(prompt);
    expect(result).toContain('iOS status bar: 7:00 AM');
    expect(result).toContain('Stacked overnight notifications');
  });

  it('includes technical specs', () => {
    const prompt: Nb2Prompt = {
      subject: [{ description: 'A phone' }],
      technical: {
        camera_model: 'iPhone 15 Pro screenshot capture',
        lens: 'native screen capture',
        aperture: 'infinite',
      },
    };
    const result = flattenNb2Prompt(prompt);
    expect(result).toContain('iPhone 15 Pro screenshot capture');
    expect(result).toContain('native screen capture');
    expect(result).toContain('infinite');
  });

  it('includes composition', () => {
    const prompt: Nb2Prompt = {
      subject: [{ description: 'A phone' }],
      composition: {
        framing: 'full_body',
        angle: 'eye_level',
        focus_point: 'Ghstly notification',
      },
    };
    const result = flattenNb2Prompt(prompt);
    expect(result).toContain('full_body');
    expect(result).toContain('eye_level');
    expect(result).toContain('Ghstly notification');
  });

  it('includes text rendering when enabled', () => {
    const prompt: Nb2Prompt = {
      subject: [{ description: 'A phone' }],
      text_rendering: {
        enabled: true,
        text_content: 'Sara was 320 ft away',
        font_style: 'bold_sans_serif',
        color: 'white',
      },
    };
    const result = flattenNb2Prompt(prompt);
    expect(result).toContain('Sara was 320 ft away');
    expect(result).toContain('bold_sans_serif');
    expect(result).toContain('white');
  });

  it('skips text rendering when disabled', () => {
    const prompt: Nb2Prompt = {
      subject: [{ description: 'A phone' }],
      text_rendering: {
        enabled: false,
        text_content: 'Sara was 320 ft away',
      },
    };
    const result = flattenNb2Prompt(prompt);
    expect(result).not.toContain('Sara was 320 ft away');
  });

  it('includes style modifiers', () => {
    const prompt: Nb2Prompt = {
      subject: [{ description: 'A phone' }],
      style_modifiers: {
        medium: 'digital screenshot',
        aesthetic: ['minimalist', 'mobile UI screenshot'],
      },
    };
    const result = flattenNb2Prompt(prompt);
    expect(result).toContain('digital screenshot');
    expect(result).toContain('minimalist');
    expect(result).toContain('mobile UI screenshot');
  });

  it('includes negative prompt', () => {
    const prompt: Nb2Prompt = {
      subject: [{ description: 'A phone' }],
      advanced: {
        negative_prompt: ['white background', 'device frame', 'phone bezels'],
      },
    };
    const result = flattenNb2Prompt(prompt);
    expect(result).toContain('Do NOT include:');
    expect(result).toContain('white background');
    expect(result).toContain('device frame');
    expect(result).toContain('phone bezels');
  });

  it('handles minimal prompt — only subject with description', () => {
    const prompt: Nb2Prompt = {
      subject: [{ description: 'Just a simple subject' }],
    };
    const result = flattenNb2Prompt(prompt);
    expect(result).toBe('Just a simple subject');
  });

  it('handles empty subject description gracefully', () => {
    const prompt: Nb2Prompt = {
      subject: [{ description: '' }],
    };
    expect(() => flattenNb2Prompt(prompt)).not.toThrow();
    const result = flattenNb2Prompt(prompt);
    expect(typeof result).toBe('string');
  });

  it('real-world prompt produces non-empty string (>100 chars)', () => {
    const realisticPrompt: Nb2Prompt = {
      subject: [{
        id: 'alarm_wake_up',
        type: 'object',
        description: 'iOS alarm screen in dark mode showing 7:00 AM with Ghstly notification showing Sara was 320 ft away 6 hours ago',
      }],
      scene: {
        location: 'iOS alarm screen dark mode, Echo Park California',
        time: 'early morning 7 AM',
        lighting: { type: 'ambient screen glow', direction: 'front_lit', quality: 'OLED dark alarm screen' },
        background_elements: ['iOS status bar: 7:00 AM', 'Stacked overnight notifications'],
      },
      technical: { camera_model: 'iPhone 15 Pro screenshot capture', lens: 'native screen capture', aperture: 'infinite' },
      composition: { framing: 'full_body', angle: 'eye_level', focus_point: 'Ghstly notification' },
      text_rendering: { enabled: true, text_content: 'Sara was 320 ft away', placement: 'smart_phone_screen', font_style: 'bold_sans_serif', color: 'white' },
      style_modifiers: { medium: 'digital screenshot', aesthetic: ['minimalist', 'mobile UI screenshot'] },
      advanced: { negative_prompt: ['white background', 'device frame', 'phone bezels'], magic_prompt_enhancer: false, hdr_mode: true },
    };
    const result = flattenNb2Prompt(realisticPrompt);
    expect(result.length).toBeGreaterThan(100);
    expect(result).toContain('iOS alarm screen');
    expect(result).toContain('Sara was 320 ft away');
    expect(result).toContain('Do NOT include:');
  });
});

// ---------------------------------------------------------------------------
// isNb2Json
// ---------------------------------------------------------------------------

describe('isNb2Json', () => {
  it('returns true for valid NB2 JSON', () => {
    const input = {
      subject: [{ description: 'A valid subject description' }],
    };
    expect(isNb2Json(input)).toBe(true);
  });

  it('returns false for null', () => {
    expect(isNb2Json(null)).toBe(false);
  });

  it('returns false for string', () => {
    expect(isNb2Json('not a prompt')).toBe(false);
  });

  it('returns false for object without subject array', () => {
    expect(isNb2Json({ scene: { location: 'somewhere' } })).toBe(false);
  });

  it('returns false for object with empty subject array', () => {
    expect(isNb2Json({ subject: [] })).toBe(false);
  });

  it('returns false for subject without description', () => {
    expect(isNb2Json({ subject: [{ id: 'test', type: 'object' }] })).toBe(false);
  });
});
