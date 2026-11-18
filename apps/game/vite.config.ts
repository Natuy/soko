import { shallot } from "@dylanebert/shallot/vite";

export default {
    base: "./",
    plugins: [shallot()],
    server: { fs: { allow: ["../.."] } }, // le jeu importe packages/core et /levels
};
