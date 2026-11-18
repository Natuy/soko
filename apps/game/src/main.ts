import { runApp } from "@dylanebert/shallot";
import { PuzzlePlugin } from "./puzzle";

if (!("gpu" in navigator)) {
    (document.getElementById("nogpu") as HTMLElement).style.display = "grid";
    for (const id of ["ui", "hud", "msg"]) (document.getElementById(id) as HTMLElement).hidden = true;
} else {
    await runApp({ plugins: [PuzzlePlugin] });
}
