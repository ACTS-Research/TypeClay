import { run } from "../shared/app";
import { layoutWord, toPath2D, defaultCoords } from "../shared/font";
run({
  title: "Axis Sculptor", help: [],
  init() {}, update() {},
  draw(ctx, app) {
    ctx.fillStyle = "#e8e4dc"; ctx.fillRect(0, 0, app.W, app.H);
    ctx.fillStyle = "#1b1a18";
    for (const g of layoutWord(app.font, app.word, defaultCoords(app.font), app.H * 0.3, app.W / 2, app.H * 0.6)) ctx.fill(toPath2D(g.commands));
  },
});
