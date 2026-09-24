/* eslint-disable no-console */
// The Keeki rail's glitter, generated: four tiled SVGs, one per colour, each a
// large tile holding a few dozen dots at seeded, spaced-out positions, so the
// rail shows a scattering and never a lattice. Every layer has the same tile,
// because the four drift together on one pseudo-element whose transform moves
// exactly one tile per cycle — that is what makes the loop seamless, and a
// transform is what keeps the drift off the main thread. One dot per tile (the first
// cut, a radial-gradient each) is a grid by construction — the eye reads the
// rows as soon as the drift stops, which on a phone is always — and a bigger
// period with many dots per period is the only way out that keeps the layer
// count (each layer repaints every frame while the rail drifts).
//
//   node tools/generate-keeki-glitter.mjs > /tmp/glitter.css
//
// prints the `--glitter-*` custom properties and the matching sizes to paste
// into client/themes/keeki.css; the tile is taller than most rails, so the
// same constellation is seldom on screen twice.

const TILE_W = 421;
const TILE_H = 907;

const LAYERS = [
	// name, dot count, radius range, colour (the SVG carries its own alpha)
	{name: "rose", n: 51, r: [1.0, 1.6], fill: "#e9b6a6", alpha: 0.95, seed: 11},
	{name: "pink", n: 60, r: [1.0, 1.5], fill: "#ff7bc8", alpha: 0.85, seed: 23},
	{name: "lavender", n: 49, r: [0.8, 1.3], fill: "#c9b8ff", alpha: 0.9, seed: 37},
	{name: "white", n: 70, r: [0.7, 1.2], fill: "#ffffff", alpha: 0.9, seed: 53},
].map((l) => ({...l, w: TILE_W, h: TILE_H}));

function rng(seed) {
	// Park–Miller: good enough to scatter dots, and the same every run.
	let s = seed % 2147483647;
	return () => (s = (s * 48271) % 2147483647) / 2147483647;
}

function scatter({w, h, n, r, seed}) {
	const rand = rng(seed);
	// Keep dots at least this far apart, measured on the torus the tile is,
	// so the wrap seam is as evenly spaced as the middle.
	const minDist = 0.62 * Math.sqrt((w * h) / n);
	const dots = [];
	let tries = 0;

	while (dots.length < n && tries++ < n * 400) {
		const x = rand() * w;
		const y = rand() * h;
		const ok = dots.every((d) => {
			const dx = Math.min(Math.abs(d.x - x), w - Math.abs(d.x - x));
			const dy = Math.min(Math.abs(d.y - y), h - Math.abs(d.y - y));
			return dx * dx + dy * dy >= minDist * minDist;
		});

		if (ok) {
			dots.push({x, y, r: r[0] + rand() * (r[1] - r[0])});
		}
	}

	if (dots.length < n) {
		throw new Error(`only placed ${dots.length}/${n} dots`);
	}

	return dots;
}

function svg({w, h, fill, alpha}, dots) {
	const circles = dots
		.map((d) => `<circle cx='${d.x.toFixed(1)}' cy='${d.y.toFixed(1)}' r='${d.r.toFixed(2)}'/>`)
		.join("");
	const body =
		`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}'>` +
		`<g fill='${fill}' opacity='${alpha}'>${circles}</g></svg>`;
	return body.replace(/#/g, "%23").replace(/</g, "%3C").replace(/>/g, "%3E");
}

for (const layer of LAYERS) {
	const dots = scatter(layer);
	console.log(`\t--glitter-${layer.name}: url("data:image/svg+xml,${svg(layer, dots)}");`);
}

console.log(
	`\n/* background-size: ${TILE_W}px ${TILE_H}px; the drift is translate(${TILE_W}px, ${TILE_H}px) */`
);
