"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Inyección de estilos del proyecto DENTRO del iframe del canvas de Puck.
 *
 * Se monta vía `overrides.iframe` ({ children, document }) y aporta
 * `studioCanvasCss`:
 * - la paleta base del sitio (`canvasBaseCss`): clases `neutral-*`/`amber-*`
 *   que el build de la plataforma purga (§11.4) pero el registry usa;
 * - las variables `--brand-*`/`--font-*`/`--space-*`/`--radius-*` del
 *   `design.tokens` aprobado del proyecto (`tokensCss`).
 *
 * El `<style>` se renderiza COMO JSX junto a los children: Puck portala el
 * contenido del override dentro del iframe, así que el nodo aterriza en el
 * documento correcto aunque el prop `document` llegue undefined (su entrega
 * no está garantizada en 0.21 — verificado en runtime). El efecto, además,
 * re-copia el CSS al final del `head` del iframe cuando el documento es
 * alcanzable, para ganar la cascada a las hojas que Puck copia del padre.
 */

const STYLE_ELEMENT_ID = "studio-canvas-css";

export function CanvasIframeStyles({
  css,
  document: iframeDocument,
  children,
}: {
  css: string;
  /** Document del iframe del canvas (opcional: Puck no garantiza entregarlo). */
  document?: Document;
  children: ReactNode;
}) {
  const inlineRef = useRef<HTMLStyleElement | null>(null);

  useEffect(() => {
    const doc = iframeDocument ?? inlineRef.current?.ownerDocument;
    if (!doc || doc === window.document) return;
    let element = doc.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
    if (!element) {
      element = doc.createElement("style");
      element.id = STYLE_ELEMENT_ID;
    }
    element.textContent = css;
    // appendChild es idempotente: si ya está en el head lo mueve al final.
    doc.head.appendChild(element);
  }, [iframeDocument, css]);

  return (
    <>
      <style ref={inlineRef} data-studio-canvas-inline="" dangerouslySetInnerHTML={{ __html: css }} />
      {children}
    </>
  );
}
