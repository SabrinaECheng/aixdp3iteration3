"use client";

import { useMemo } from "react";
import { buildModel, type ModelGeometry } from "@/lib/model3d";
import styles from "./kiosk.module.css";

// The product as a stack of extruded SVG slices under CSS perspective. It sways slowly on its own.
export default function Model3D<Id extends string>(props: {
  geo: ModelGeometry<Id>;
  accent: string;
  explode: number;
  highlight: readonly Id[];
}) {
  const { geo, accent, explode, highlight } = props;
  const slices = useMemo(() => buildModel({ geo, w: 460, accent, explode, highlight }), [geo, accent, explode, highlight]);
  return (
    <>
      <div className={styles.modelShadow} />
      <div className={styles.modelWrap}>
        <div className={styles.model}>
          {slices.map((sl, i) => (
            <svg
              key={i}
              viewBox="-60 -110 520 560"
              width="460"
              height="495"
              aria-hidden="true"
              className={styles.slice}
              style={{ transform: `translateZ(${sl.z}px)` }}
            >
              {sl.paths.map((p) => (
                <path
                  key={p.key}
                  d={p.d}
                  transform={p.tf}
                  fill={p.fill}
                  fillRule="evenodd"
                  stroke={p.stroke}
                  strokeWidth={p.sw}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={p.op}
                />
              ))}
            </svg>
          ))}
        </div>
      </div>
    </>
  );
}
