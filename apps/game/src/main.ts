import { runApp } from "@dylanebert/shallot";
import { PuzzlePlugin } from "./puzzle";

if (!("gpu" in navigator)) {
    (document.getElementById("nogpu") as HTMLElement).style.display = "grid";
} else {
    await runApp({ plugins: [PuzzlePlugin] });
}
