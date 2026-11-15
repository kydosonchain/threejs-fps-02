// The look plan, in one place. Dusk at a derelict desert relay yard: warm sand and rust
// against a cold teal dusk sky. The same names are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#191009', // dusk sky / fog
  surface: '#2b2015', // walls, ground
  hairline: '#4a3823', // crates, trim
  sand: '#c8a06a', // site plates, walkways
  rust: '#b4552d', // containers, enemy team
  teal: '#46c2b0', // friendly team, lamps
  ink: '#efe6d8', // text, light
  muted: '#9a8a76', // dim text
  accent: '#e07830', // crosshair, warnings, spike
};

export function shade(name) {
  return PALETTE[name];
}
