const paths = {
  cursor: "m4 2 13 9-6 1-3 6Z",
  hand: "M7 10V5a1.5 1.5 0 0 1 3 0v4-6a1.5 1.5 0 0 1 3 0v6-4a1.5 1.5 0 0 1 3 0v5-2a1.5 1.5 0 0 1 3 0v6c0 4-3 6-6 6-3 0-4-2-6-4l-3-4c-1-2 1-3 2-2l2 2",
  rect: "M4 3h12a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z",
  ellipse: "M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
  line: "m3 17 14-14",
  text: "M3 4h14M10 4v13M7 17h6",
  frame: "M6 2v16M14 2v16M2 6h16M2 14h16",
  plus: "M10 4v12M4 10h12",
  minus: "M4 10h12",
  undo: "m7 4-4 4 4 4M3 8h9a5 5 0 0 1 0 10",
  redo: "m13 4 4 4-4 4M17 8H8a5 5 0 0 0 0 10",
  import: "M10 2v10m-4-4 4 4 4-4M3 13v4h14v-4",
  export: "M10 12V2m-4 4 4-4 4 4M3 13v4h14v-4",
  save: "M4 3h10l3 3v11H3V3h1M6 3v5h8V3M6 17v-6h8v6",
  play: "m6 3 11 7-11 7Z",
  restart: "M4 8a6 6 0 1 1 0 5M4 3v5h5",
  help: "M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0M8 7a2 2 0 1 1 3 2c-1 1-1 1-1 2M10 14h.01",
  page: "M5 2h7l4 4v12H4V2h1M12 2v5h4",
  search: "M13 8a5 5 0 1 1-10 0 5 5 0 0 1 10 0m-1 4 5 5",
  desktop: "M2 3h16v11H2ZM10 14v4M6 18h8",
  mobile: "M6 2h8v16H6ZM9 15h2",
  close: "m5 5 10 10M15 5 5 15",
  image: "M3 3h14v14H3Zm0 10 4-4 4 4 3-3 3 3M13 6h.01",
  vector: "M5 5h10v10H5ZM5 5l10 10M5 15 15 5",
  triangle: "m10 3 8 14H2Z",
  star: "m10 2 2.5 5.5 6 .7-4.5 4 1.3 6L10 15l-5.3 3.2 1.3-6-4.5-4 6-.7Z",
  eye: "M1 10s3-6 9-6 9 6 9 6-3 6-9 6-9-6-9-6ZM12 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0",
  eyeoff:
    "M3 3l14 14M7 4a10 10 0 0 1 12 6s-1 3-4 4M11 16C5 17 1 10 1 10s1-2 3-4",
  lock: "M5 9h10v9H5ZM7 9V6a3 3 0 0 1 6 0v3",
  unlock: "M5 9h10v9H5ZM7 9V6a3 3 0 0 1 6 0",
  group:
    "M2 2h5v5H2ZM13 2h5v5h-5ZM2 13h5v5H2Zm11 0h5v5h-5ZM7 4h6M4 7v6M16 7v6M7 16h6",
  layers: "m10 2 8 5-8 5-8-5Zm-8 9 8 5 8-5M2 15l8 5 8-5",
  alignleft: "M3 2v16M6 5h11v3H6Zm0 7h7v3H6Z",
  aligncenter: "M10 2v16M3 5h14v3H3Zm3 7h8v3H6Z",
  alignright: "M17 2v16M3 5h11v3H3Zm4 7h7v3H7Z",
  aligntop: "M2 3h16M5 6h3v11H5Zm7 0h3v7h-3Z",
  alignmiddle: "M2 10h16M5 3h3v14H5Zm7 3h3v8h-3Z",
  alignbottom: "M2 17h16M5 3h3v11H5Zm7 4h3v7h-3Z",
  distributex: "M2 3v14M18 3v14M6 6h2v8H6Zm6 0h2v8h-2Z",
  distributey: "M3 2h14M3 18h14M6 6h8v2H6Zm0 6h8v2H6Z",
  arrowup: "M10 17V3m-5 5 5-5 5 5",
  arrowdown: "M10 3v14m-5-5 5 5 5-5",
  copy: "M7 7h10v10H7ZM4 13H2V2h11v2",
  trash: "M3 5h14M7 5V2h6v3M5 5l1 13h8l1-13M8 8v7M12 8v7",
  motion: "M11 2 4 11h5l-1 7 8-10h-5Z",
  code: "m6 5-5 5 5 5m8-10 5 5-5 5m-3-12-2 14",
  chevron: "m7 4 6 6-6 6",
  link: "m7 13 6-6M8 5l2-2a4 4 0 0 1 6 6l-2 2M12 15l-2 2a4 4 0 0 1-6-6l2-2",
  folder: "M2 5h6l2 2h8v10H2V5Zm0 0V3h6l2 2h8v2",
  grid: "M3 3h5v5H3Zm9 0h5v5h-5ZM3 12h5v5H3Zm9 0h5v5h-5",
  check: "m4 10 4 4 8-9",
};
export function icon(name) {
  return `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="${paths[name] || paths.rect}"/></svg>`;
}
export function hydrateIcons(root = document) {
  root
    .querySelectorAll("[data-icon]")
    .forEach((el) => (el.innerHTML = icon(el.dataset.icon)));
  root
    .querySelectorAll("[data-leading]")
    .forEach((el) =>
      el.insertAdjacentHTML("afterbegin", icon(el.dataset.leading)),
    );
}
