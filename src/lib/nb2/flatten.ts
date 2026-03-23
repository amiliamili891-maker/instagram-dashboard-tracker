import type { Nb2Prompt } from './types';

/**
 * Flatten an {@link Nb2Prompt} JSON object into a single text prompt string
 * suitable for the Gemini image generation API.
 *
 * Sections are concatenated in priority order. Any section that is missing or
 * empty is silently skipped.
 */
export function flattenNb2Prompt(prompt: Nb2Prompt): string {
  const parts: string[] = [];

  // 1. Subject descriptions (highest priority)
  for (const s of prompt.subject) {
    if (s.description) {
      parts.push(s.description);
    }
  }

  // 2. Scene context
  if (prompt.scene) {
    const { location, time, lighting } = prompt.scene;
    const sceneParts: string[] = [];
    if (location) sceneParts.push(location);
    if (time) sceneParts.push(time);
    if (lighting) {
      if (lighting.type) sceneParts.push(lighting.type);
      if (lighting.direction) sceneParts.push(lighting.direction);
      if (lighting.quality) sceneParts.push(lighting.quality);
    }
    if (sceneParts.length > 0) {
      parts.push(sceneParts.join(', ') + '.');
    }

    // 3. Background elements
    if (
      prompt.scene.background_elements &&
      prompt.scene.background_elements.length > 0
    ) {
      parts.push(prompt.scene.background_elements.join('. ') + '.');
    }
  }

  // 4. Technical
  if (prompt.technical) {
    const { camera_model, lens, aperture } = prompt.technical;
    const techParts: string[] = [];
    if (camera_model) techParts.push(camera_model);
    if (lens) techParts.push(lens);
    if (aperture) techParts.push(aperture);
    if (techParts.length > 0) {
      parts.push(techParts.join(', ') + '.');
    }
  }

  // 5. Composition
  if (prompt.composition) {
    const { framing, angle, focus_point } = prompt.composition;
    const compParts: string[] = [];
    if (framing) compParts.push(framing);
    if (angle) compParts.push(angle);
    if (focus_point) compParts.push(focus_point);
    if (compParts.length > 0) {
      parts.push(compParts.join(', ') + '.');
    }
  }

  // 6. Text rendering
  if (prompt.text_rendering && prompt.text_rendering.enabled) {
    const { text_content, font_style, color } = prompt.text_rendering;
    if (text_content) {
      const styleDesc = [font_style, color].filter(Boolean).join(', ');
      parts.push(
        styleDesc
          ? `Text on screen: '${text_content}' in ${styleDesc}.`
          : `Text on screen: '${text_content}'.`,
      );
    }
  }

  // 7. Style modifiers
  if (prompt.style_modifiers) {
    const { medium, aesthetic } = prompt.style_modifiers;
    const styleParts: string[] = [];
    if (medium) styleParts.push(medium);
    if (aesthetic && aesthetic.length > 0) {
      styleParts.push(...aesthetic);
    }
    if (styleParts.length > 0) {
      parts.push(styleParts.join(', ') + '.');
    }
  }

  // 8. Negative prompt
  if (
    prompt.advanced?.negative_prompt &&
    prompt.advanced.negative_prompt.length > 0
  ) {
    parts.push(
      `Do NOT include: ${prompt.advanced.negative_prompt.join(', ')}.`,
    );
  }

  return parts.join(' ');
}

/**
 * Runtime type guard that checks whether an unknown value conforms to the
 * minimal shape of an {@link Nb2Prompt}.
 *
 * Validates that the input is an object with a `subject` array containing at
 * least one entry that has a non-empty `description` string.
 */
export function isNb2Json(input: unknown): input is Nb2Prompt {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return false;
  }

  const obj = input as Record<string, unknown>;

  if (!Array.isArray(obj.subject) || obj.subject.length === 0) {
    return false;
  }

  return obj.subject.every(
    (entry: unknown) =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as Record<string, unknown>).description === 'string' &&
      ((entry as Record<string, unknown>).description as string).length > 0,
  );
}
