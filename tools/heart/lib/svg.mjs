// The <3 theme's animal file formats (tools/heart/README.md § The files).

export const SKY = "#dbeeff";

/** `w` of hexB mixed into hexA in sRGB, as #rrggbb — color-mix(in srgb, A, B w). */
export function mix(hexA, hexB, w) {
	const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
	const a = rgb(hexA);
	const b = rgb(hexB);
	return (
		"#" +
		a
			.map((c, i) =>
				Math.round(c * (1 - w) + b[i] * w)
					.toString(16)
					.padStart(2, "0")
			)
			.join("")
	);
}

/**
 * A closed outline (flat [x, y, …]) as path data: every stride-th point,
 * scaled by k and rounded to an integer first, written as one absolute
 * move and relative lines, so rounding never drifts along the outline and a
 * frame costs about four characters a point.
 */
export function encodePath(pts, k = 1, stride = 1) {
	const xs = [];
	const ys = [];
	for (let i = 0; i < pts.length; i += 2 * stride) {
		xs.push(Math.round(pts[i] * k));
		ys.push(Math.round(pts[i + 1] * k));
	}
	let d = `M${xs[0]},${ys[0]}`;
	for (let i = 1; i < xs.length; i++) d += `l${xs[i] - xs[i - 1]},${ys[i] - ys[i - 1]}`;
	return d + "z";
}

/** The absolute points of a path encodePath wrote. */
export function decodePath(d) {
	const out = [];
	let x = 0;
	let y = 0;
	d.slice(1, -1)
		.split("l")
		.forEach((pair, i) => {
			const [dx, dy] = pair.split(",").map(Number);
			if (i === 0) {
				x = dx;
				y = dy;
			} else {
				x += dx;
				y += dy;
			}
			out.push([x, y]);
		});
	return out;
}

/** Attribute numbers: up to four decimals, no trailing zeros. */
export const fmt = (n) => String(Math.round(n * 1e4) / 1e4);

const animate = (attrs) =>
	`<animate${Object.entries(attrs)
		.map(([k, v]) => ` ${k}="${v}"`)
		.join("")}/>`;

/**
 * An animal file: a wide stage; the animal's paths, far legs first and the
 * near outline last so it paints on top, each morphing through the
 * sequence's clips in one chain (the ids and the chain live on the near
 * path, the others sync to its begins); the travel as a translate over the
 * whole loop; and, when the sequence turns, a mirror flip about the
 * animal's centre at that moment (a scale about the centre: the two static
 * translates bracket it). Hearts, when given, ride inside the same groups.
 */
export function animalSvg({viewBox: vb, k, stageW, layers, clips, travel, flip, hearts}) {
	const last = layers.length - 1;
	const centre = (vb.x + vb.w / 2) * k;
	const paths = layers.map((layer, i) => {
		const anims = clips.map((c) => {
			const attrs = {};
			if (i === last) attrs.id = c.id;
			attrs.attributeName = "d";
			attrs.calcMode = "linear";
			attrs.values = c.values.map((f) => f[i]).join(";");
			attrs.keyTimes = c.keyTimes.map(fmt).join(";");
			attrs.dur = `${fmt(c.dur)}s`;
			attrs.begin = i === last ? c.begin : `${c.id}.begin`;
			if (c.repeat > 1) attrs.repeatCount = c.repeat;
			attrs.fill = "freeze";
			return animate(attrs);
		});
		return `<path fill="${layer.fill}" d="${clips[0].values[0][i]}">${anims.join("")}</path>`;
	});
	const heart = hearts
		? `<path fill="${hearts.fill}" opacity="0" transform="translate(${fmt(hearts.x)} ${fmt(
				hearts.y
		  )})" d="${hearts.d}">` +
		  animate({
				attributeName: "opacity",
				calcMode: "linear",
				values: "0;1;1;0",
				keyTimes: "0;0.15;0.6;1",
				dur: "1.4s",
				begin: hearts.begin,
		  }) +
		  `<animateTransform attributeName="transform" type="translate" additive="sum" calcMode="linear" values="0 0;0 ${fmt(
				-hearts.rise
		  )}" dur="1.4s" begin="${hearts.begin}"/></path>`
		: "";
	const scale = flip
		? `<animateTransform attributeName="transform" type="scale" additive="sum" calcMode="discrete" values="1 1;-1 1" keyTimes="0;${fmt(
				flip.at
		  )}" dur="${fmt(travel.period)}s" repeatCount="indefinite"/>`
		: "";
	const translate = `<animateTransform attributeName="transform" type="translate" calcMode="linear" values="${travel.xs
		.map((x) => `${fmt(x)} 0`)
		.join(";")}" keyTimes="${travel.keyTimes.map(fmt).join(";")}" dur="${fmt(
		travel.period
	)}s" repeatCount="indefinite"/>`;
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${fmt(vb.y * k)} ${fmt(
			stageW * k
		)} ${fmt(vb.h * k)}">` +
		`<g>${translate}<g transform="translate(${fmt(
			centre
		)} 0)">${scale}<g transform="translate(${fmt(-centre)} 0)">${paths.join(
			""
		)}${heart}</g></g></g></svg>\n`
	);
}

/** One frame, no stage, no motion: the reduced-motion still, in the rig's own box. */
export function stillSvg({viewBox: vb, k, layers, frame}) {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(vb.x * k)} ${fmt(
		vb.y * k
	)} ${fmt(vb.w * k)} ${fmt(vb.h * k)}">${layers
		.map((l, i) => `<path fill="${l.fill}" d="${frame[i]}"/>`)
		.join("")}</svg>\n`;
}
