/**
 * NB2 (Nano Banana 2) Prompt Schema Types
 *
 * TypeScript interfaces for the structured JSON prompt format
 * used to generate ad creatives via the Gemini image generation API.
 */

// ---------------------------------------------------------------------------
// Constant enums
// ---------------------------------------------------------------------------

/** Valid aspect ratios for NB2 image generation */
export const NB2_ASPECT_RATIOS = [
  '9:16',
  '1:1',
  '16:9',
  '4:5',
  '4:3',
  '3:4',
  '21:9',
  '3:2',
  '2:3',
  '5:4',
] as const;

export type Nb2AspectRatio = (typeof NB2_ASPECT_RATIOS)[number];

/** Supported output resolutions */
export const NB2_RESOLUTIONS = ['1K', '2K', '4K'] as const;

export type Nb2Resolution = (typeof NB2_RESOLUTIONS)[number];

// ---------------------------------------------------------------------------
// Nested interfaces
// ---------------------------------------------------------------------------

/** Image generation parameters */
export interface Nb2Meta {
  /** Aspect ratio of the generated image (e.g. "9:16") */
  aspect_ratio?: Nb2AspectRatio;
  /** Quality preset — typically "ultra_photorealistic" */
  quality?: string;
  /** RNG seed for reproducibility. null = random. */
  seed?: number | null;
  /** Diffusion steps — higher = more detail, slower */
  steps?: number;
  /** CFG / guidance scale — how closely the model follows the prompt */
  guidance_scale?: number;
}

/** A single subject element in the scene */
export interface Nb2Subject {
  /** Unique identifier for this subject */
  id?: string;
  /** Subject category (e.g. "object", "person", "text_overlay") */
  type?: string;
  /** Detailed 3-5 sentence visual description including hex colors. REQUIRED. */
  description: string;
}

/** Lighting configuration for the scene */
export interface Nb2Lighting {
  /** Light source type (e.g. "ambient screen glow", "golden hour sunlight") */
  type?: string;
  /** Direction of primary light (e.g. "front_lit", "back_lit", "side_lit") */
  direction?: string;
  /** Quality descriptor (e.g. "OLED screen emission", "soft diffused") */
  quality?: string;
}

/** Scene / environment configuration */
export interface Nb2Scene {
  /** Physical or virtual location description */
  location?: string;
  /** Time of day or lighting time reference */
  time?: string;
  /** Lighting setup for the scene */
  lighting?: Nb2Lighting;
  /** Additional background elements to include */
  background_elements?: string[];
}

/** Camera / technical rendering parameters */
export interface Nb2Technical {
  /** Camera model or capture method */
  camera_model?: string;
  /** Lens type or description */
  lens?: string;
  /** Aperture setting or descriptor */
  aperture?: string;
}

/** Shot composition parameters */
export interface Nb2Composition {
  /** Framing type (e.g. "full_body", "close_up", "medium_shot") */
  framing?: string;
  /** Camera angle (e.g. "eye_level", "high_angle", "low_angle") */
  angle?: string;
  /** Where the viewer's eye should land */
  focus_point?: string;
}

/** Text overlay / text rendering configuration */
export interface Nb2TextRendering {
  /** Whether text should be rendered in the image */
  enabled?: boolean;
  /** The actual text string to render */
  text_content?: string;
  /** Where the text appears (e.g. "smart_phone_screen", "top_center") */
  placement?: string;
  /** Font style (e.g. "bold_sans_serif", "handwritten") */
  font_style?: string;
  /** Text color, may include hex values */
  color?: string;
}

/** Visual style and aesthetic modifiers */
export interface Nb2StyleModifiers {
  /** Rendering medium (e.g. "digital screenshot", "oil painting") */
  medium?: string;
  /** Aesthetic tags that guide the overall look */
  aesthetic?: string[];
}

/** Advanced generation controls */
export interface Nb2Advanced {
  /** Elements to explicitly exclude from the image */
  negative_prompt?: string[];
  /** Whether to use the model's built-in prompt enhancement */
  magic_prompt_enhancer?: boolean;
  /** Enable HDR tone mapping */
  hdr_mode?: boolean;
}

// ---------------------------------------------------------------------------
// Main prompt interface
// ---------------------------------------------------------------------------

/**
 * Complete NB2 structured prompt.
 *
 * The only required field is `subject` — an array with at least one entry
 * whose `description` is a non-empty string. All other sections are optional
 * and will be skipped during flattening if absent.
 */
export interface Nb2Prompt {
  /** Image generation meta-parameters */
  meta?: Nb2Meta;
  /** Subject elements to render. At least one entry with a description is required. */
  subject: Nb2Subject[];
  /** Scene / environment configuration */
  scene?: Nb2Scene;
  /** Camera and technical rendering parameters */
  technical?: Nb2Technical;
  /** Shot composition */
  composition?: Nb2Composition;
  /** Text overlay configuration */
  text_rendering?: Nb2TextRendering;
  /** Visual style modifiers */
  style_modifiers?: Nb2StyleModifiers;
  /** Advanced generation controls (negative prompt, HDR, etc.) */
  advanced?: Nb2Advanced;
}
