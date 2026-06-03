shader_type canvas_item;

// =============================================================================
// Neon Glow Post-Processing Effect
// =============================================================================
// Adds bloom-like glow to bright elements in the scene.
// Apply to a ColorRect overlay covering the viewport.
//
// How it works:
//   1. Extracts bright parts of the scene above the threshold
//   2. Applies a weighted box blur to create the glow
//   3. Combines the glow with the original image
//
// Parameters:
//   glow_intensity  - Strength of the glow effect (0 = off, 3 = very bright)
//   glow_threshold  - Luminance threshold for glow extraction (0-1)
//                     Pixels darker than this won't glow
//   blur_iterations - Quality of the blur (1 = fast/rough, 8 = slow/smooth)
//                     Higher = more samples, better quality
//   blur_size       - Spread of the glow effect (0.5 = tight, 10 = wide)
//
// Performance Notes:
//   - blur_iterations has quadratic performance impact (4 = 9 samples, 8 = 17 samples)
//   - For mobile, use blur_iterations = 2-3
//   - Consider disabling on lower-end devices
// =============================================================================

uniform sampler2D screen_texture : hint_screen_texture, repeat_disable, filter_linear_mipmap;
uniform float glow_intensity : hint_range(0.0, 3.0) = 1.5;
uniform float glow_threshold : hint_range(0.0, 1.0) = 0.4;
uniform int blur_iterations : hint_range(1, 8) = 4;
uniform float blur_size : hint_range(0.5, 10.0) = 3.0;

void fragment() {
	vec4 original = texture(screen_texture, SCREEN_UV);

	// Extract bright parts
	float luminance = dot(original.rgb, vec3(0.299, 0.587, 0.114));
	vec3 bright = original.rgb * smoothstep(glow_threshold, glow_threshold + 0.2, luminance);

	// Simple box blur for glow
	vec3 glow = vec3(0.0);
	float total_weight = 0.0;
	vec2 pixel_size = 1.0 / vec2(textureSize(screen_texture, 0));

	for (int i = -blur_iterations; i <= blur_iterations; i++) {
		for (int j = -blur_iterations; j <= blur_iterations; j++) {
			vec2 offset = vec2(float(i), float(j)) * pixel_size * blur_size;
			vec4 sample_col = texture(screen_texture, SCREEN_UV + offset);
			float sample_lum = dot(sample_col.rgb, vec3(0.299, 0.587, 0.114));
			vec3 sample_bright = sample_col.rgb * smoothstep(glow_threshold, glow_threshold + 0.2, sample_lum);
			float weight = 1.0 / (1.0 + length(vec2(float(i), float(j))));
			glow += sample_bright * weight;
			total_weight += weight;
		}
	}
	glow /= total_weight;

	COLOR = vec4(original.rgb + glow * glow_intensity, original.a);
}
