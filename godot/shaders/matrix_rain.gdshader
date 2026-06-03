shader_type canvas_item;

// =============================================================================
// Matrix Rain Effect — Falling green characters on a transparent background
// =============================================================================
// Usage: Apply to a ColorRect or TextureRect covering the viewport.
// Best used with low opacity (0.05-0.15) as an overlay layer.
//
// Parameters:
//   speed       - How fast columns fall (0.1 = slow, 5.0 = fast)
//   density     - Number of columns across screen (1 = sparse, 50 = dense)
//   brightness  - Overall intensity of the effect (0 = off, 1 = full)
//   trail_length- How long the trail is behind each character (0.1 = short, 1 = long)
//   rain_color  - Color of the rain (default: Matrix green #00ff41)
// =============================================================================

uniform float speed : hint_range(0.1, 5.0) = 1.0;
uniform float density : hint_range(1.0, 50.0) = 20.0;
uniform float brightness : hint_range(0.0, 1.0) = 0.8;
uniform float trail_length : hint_range(0.1, 1.0) = 0.6;
uniform vec4 rain_color : source_color = vec4(0.0, 1.0, 0.255, 1.0); // #00ff41 Matrix green

// Hash function for pseudo-random values
float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// Character-like pattern using grid cells
float character(vec2 uv, float seed) {
	// Create a grid pattern that looks like characters
	vec2 grid = fract(uv * 5.0);
	float h = hash(vec2(floor(uv.x * 5.0), floor(uv.y * 5.0)) + seed);
	// Threshold to create glyph-like shapes
	float c = step(0.3, h) * step(grid.x, 0.8) * step(grid.y, 0.8);
	c *= step(0.5, hash(grid + seed));
	return c;
}

void fragment() {
	vec2 uv = UV;
	float col_count = density;
	float col = floor(uv.x * col_count);
	float col_offset = hash(vec2(col, 0.0));

	// Speed varies per column
	float fall_speed = speed * (0.5 + col_offset);
	float t = TIME * fall_speed + col_offset * 100.0;

	// The "head" of each rain drop
	float row = fract(t * 0.3);
	float y_pos = 1.0 - uv.y;

	// Distance from the head
	float dist = y_pos - row;
	if (dist < 0.0) dist += 1.0; // Wrap around

	// Trail fade
	float trail = 1.0 - smoothstep(0.0, trail_length, dist);
	trail = pow(trail, 2.0);

	// Character flicker
	float char_seed = floor(t * 8.0 + uv.y * 20.0);
	float char_val = character(uv * vec2(col_count, col_count * 2.0), char_seed);

	// Head glow (brightest point)
	float head_glow = smoothstep(0.02, 0.0, dist) * 2.0;

	float alpha = trail * brightness * (char_val * 0.7 + 0.3);
	alpha += head_glow * 0.5;
	alpha = clamp(alpha, 0.0, 1.0);

	// Color: green with brighter head
	vec3 final_color = rain_color.rgb * (1.0 + head_glow);

	COLOR = vec4(final_color, alpha * rain_color.a);
}
