/**
 * §18.1 punto 7 — programmatic seed: 6 testimonials, 6 posts, 8 pages with
 * 50+ sections total (home has 12). Run with: npm run seed
 * (uses `payload run`, which executes TS against the embedded SQLite DB)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getPayload } from "payload";
// NOTE: `payload run` executes scripts through tsx; importing the TS config
// from an .mts script double-wraps the default export (mod.default). Unwrap.
import configModule from "../payload.config.ts";

const config = await (
  (configModule as unknown as { default?: unknown }).default ?? configModule
);

const dirname = path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(path.resolve(dirname, "../.data"), { recursive: true });

let counter = 0;
const c = (type: string, props: Record<string, unknown>) => ({
  type,
  props: { id: `${type}-${String(++counter).padStart(3, "0")}`, ...props },
});

const navbar = () =>
  c("Navbar", {
    brand: "Estudio Norte",
    tone: "light",
    sticky: true,
    links: [
      { label: "Producto", href: "/features" },
      { label: "Precios", href: "/pricing" },
      { label: "Clientes", href: "/customers" },
      { label: "Blog", href: "/blog" },
    ],
    ctaLabel: "Contactar",
    ctaHref: "/contact",
  });

const footer = () =>
  c("Footer", {
    brand: "Estudio Norte",
    tagline: "Páginas compuestas con secciones gobernadas.",
    tone: "dark",
    columns: [
      {
        title: "Producto",
        links: [
          { label: "Features", href: "/features" },
          { label: "Precios", href: "/pricing" },
        ],
      },
      {
        title: "Empresa",
        links: [
          { label: "Sobre nosotros", href: "/about" },
          { label: "Contacto", href: "/contact" },
        ],
      },
      {
        title: "Legal",
        links: [{ label: "Términos", href: "/legal/terms" }],
      },
    ],
    legal: "© 2026 Estudio Norte. Spike desechable.",
  });

async function run() {
  const payload = await getPayload({ config: config as never });

  // wipe (spike: idempotent re-seed)
  for (const collection of ["pages", "testimonials", "posts"] as const) {
    await payload.delete({ collection, where: { id: { exists: true } } });
  }

  // --- CMS content (bindings target) -------------------------------------
  const testimonialDocs = [
    { author: "Lucía Ferrer", role: "Head of Digital", company: "Atlántica Foods", quote: "Pasamos de tres semanas a tres días por landing. El registry obliga a la coherencia y eso nos salvó el rebrand.", rating: 5 },
    { author: "Marc Soler", role: "CTO", company: "Verda Energy", quote: "El diff antes de publicar es lo que toda agencia debería exigir. Nadie toca producción a ciegas.", rating: 5 },
    { author: "Irene Castaño", role: "Directora de Marca", company: "Museo Lume", quote: "Por fin un editor donde el cliente no puede romper la tipografía.", rating: 4 },
    { author: "Pablo Hidalgo", role: "Founder", company: "Korto", quote: "Las secciones CMS se actualizan solas cuando cambiamos un testimonio. Cero copy-paste.", rating: 5 },
    { author: "Nadia Ben Amar", role: "Product Lead", company: "Faro Salud", quote: "La revisión con estados draft/aprobado encaja con nuestro flujo legal sin inventar nada.", rating: 4 },
    { author: "Jon Etxeberria", role: "COO", company: "Bidea Logistics", quote: "Ocho páginas en una tarde, y el build sigue bajando verde.", rating: 5 },
  ];
  const testimonials: Array<{ id: string | number } & Record<string, unknown>> = [];
  for (const data of testimonialDocs) {
    testimonials.push((await payload.create({ collection: "testimonials", data })) as never);
  }

  const postDocs = [
    { title: "Por qué un registry de 30 secciones basta", excerpt: "La libertad visual infinita es deuda de diseño. Variantes enumeradas, no CSS libre.", category: "Opinión", publishedAt: "2026-05-02" },
    { title: "Diff estructural para páginas compuestas", excerpt: "Comparar JSON por id estable convierte la revisión en un acto de 30 segundos.", category: "Ingeniería", publishedAt: "2026-04-18" },
    { title: "Bindings CMS sin acoplarse al editor", excerpt: "La referencia vive en el Data JSON; el contenido vive en Payload. Se resuelve al renderizar.", category: "Ingeniería", publishedAt: "2026-03-30" },
    { title: "Caso: rebrand de Atlántica Foods", excerpt: "42 páginas regeneradas con tokens nuevos en una semana.", category: "Casos", publishedAt: "2026-03-12" },
    { title: "El cliente comenta, el sistema recuerda", excerpt: "Aprobaciones con nombre y fecha, no hilos de email.", category: "Producto", publishedAt: "2026-02-20" },
    { title: "SQLite embebido para CMS por proyecto", excerpt: "Cero servidores en local; Postgres llega en producción.", category: "Ingeniería", publishedAt: "2026-01-15" },
  ];
  const posts: Array<{ id: string | number } & Record<string, unknown>> = [];
  for (const data of postDocs) {
    posts.push((await payload.create({ collection: "posts", data })) as never);
  }

  const tRef = (i: number) => ({
    docId: testimonials[i].id,
    collection: "testimonials",
    author: testimonials[i].author,
    role: testimonials[i].role,
    company: testimonials[i].company,
    quote: testimonials[i].quote,
    rating: testimonials[i].rating,
  });
  const pRef = (i: number) => ({
    docId: posts[i].id,
    collection: "posts",
    title: posts[i].title,
    excerpt: posts[i].excerpt,
    category: posts[i].category,
    publishedAt: posts[i].publishedAt,
  });

  // --- pages ---------------------------------------------------------------
  type Page = {
    title: string;
    path: string;
    approvalStatus: "draft" | "in_review" | "approved";
    content: ReturnType<typeof c>[];
    publishedContent?: ReturnType<typeof c>[] | null; // null = never published
    description?: string;
  };

  const homeHero = c("Hero", {
    eyebrow: "Agency Workstation",
    title: "Sitios gobernados, compuestos en horas",
    subtitle: "Registry de secciones tipadas, bindings CMS reales y aprobación con diff antes de publicar.",
    align: "center", tone: "light", padding: "spacious", size: "large",
    primaryCta: "Ver precios", primaryCtaHref: "/pricing",
    secondaryCta: "Cómo funciona", secondaryCtaStyle: "ghost",
  });

  const homeContent = [
    c("Banner", { text: "Spike §18.1 — todo lo que ves sale de un Data JSON.", linkLabel: "Ver informe", linkHref: "#", tone: "brand" }),
    navbar(),
    homeHero,
    c("LogoCloud", { title: "Confían en nosotros", tone: "light", logos: [{ name: "Atlántica" }, { name: "Verda" }, { name: "Lume" }, { name: "Korto" }, { name: "Faro" }, { name: "Bidea" }] }),
    c("Features", {
      eyebrow: "Producto", title: "Composición sin CSS libre", subtitle: "Cada opción visual es una variante enumerada del registry.",
      columns: "3", tone: "light", padding: "normal",
      items: [
        { icon: "🧩", title: "32 secciones tipadas", body: "Props y variantes con contrato." },
        { icon: "🔗", title: "Bindings CMS", body: "Testimonios y posts desde Payload." },
        { icon: "✅", title: "Aprobación con diff", body: "Nada llega a producción sin revisión." },
        { icon: "📱", title: "Preview responsive", body: "Móvil, tablet y escritorio." },
        { icon: "🗂️", title: "Multi-página", body: "Catch-all por URL, rutas anidadas." },
        { icon: "🪶", title: "SQLite embebido", body: "Cero servidores en local." },
      ],
    }),
    c("Stats", { title: "", tone: "dark", padding: "normal", stats: [{ value: "8", label: "páginas seed" }, { value: "53", label: "secciones" }, { value: "32", label: "componentes registry" }] }),
    c("ImageText", { title: "El editor es la plataforma", body: "El panel de aprobación vive dentro de Puck como plugin: estado, transiciones y diff del Data JSON contra lo publicado.", mediaSide: "left", tone: "light", padding: "normal" }),
    c("TestimonialWall", { eyebrow: "Clientes", title: "Lo que dicen las agencias", columns: "3", tone: "subtle", padding: "normal", items: [{ source: tRef(0) }, { source: tRef(1) }, { source: tRef(3) }] }),
    c("Pricing", {
      eyebrow: "Precios", title: "Planes por workspace", tone: "light", padding: "spacious",
      tiers: [
        { name: "Starter", price: "0€", period: "/mes", description: "Para evaluar", features: "1 proyecto\n3 páginas\nComunidad", cta: "Empezar", highlighted: false },
        { name: "Studio", price: "89€", period: "/mes", description: "Para agencias pequeñas", features: "10 proyectos\nReview de cliente\nBYOK de LLM", cta: "Probar 14 días", highlighted: true },
        { name: "Agency", price: "249€", period: "/mes", description: "Para equipos", features: "Proyectos ilimitados\nRoles y auditoría\nSoporte prioritario", cta: "Hablar con ventas", highlighted: false },
      ],
    }),
    c("Faq", {
      title: "Preguntas frecuentes", tone: "light", padding: "normal",
      items: [
        { question: "¿Puedo editar CSS a mano?", answer: "No. Las opciones visuales son variantes del registry; esa es la garantía de coherencia." },
        { question: "¿Dónde viven los datos?", answer: "El Data JSON de cada página se persiste en Payload (SQLite embebido en local)." },
        { question: "¿Quién aprueba?", answer: "Solo humanos con rol. Los agentes proponen; nunca aprueban." },
      ],
    }),
    c("CtaBanner", { title: "Compón tu primera página hoy", cta: "Crear página", ctaHref: "/", tone: "brand" }),
    footer(),
  ];

  // published baseline differs: hero title changed + Quote pending → diff demo
  const publishedHome = homeContent
    .filter((s) => s.type !== "ImageText")
    .map((s) =>
      s === homeHero
        ? { ...s, props: { ...s.props, title: "Sitios gobernados, sin sustos" } }
        : s
    );

  const pages: Page[] = [
    {
      title: "Home", path: "home", approvalStatus: "in_review",
      description: "Demo principal del spike: 12 secciones, bindings y diff.",
      content: homeContent, publishedContent: publishedHome,
    },
    {
      title: "Precios", path: "pricing", approvalStatus: "approved",
      content: [
        navbar(),
        c("Hero", { eyebrow: "Precios", title: "Paga por workspace, no por sorpresa", subtitle: "Sin margen sobre tokens: BYOK.", align: "center", tone: "subtle", padding: "normal", size: "normal", primaryCta: "Empezar", primaryCtaHref: "#", secondaryCta: "", secondaryCtaStyle: "ghost" }),
        c("Pricing", {
          eyebrow: "", title: "Tres planes", tone: "light", padding: "spacious",
          tiers: [
            { name: "Starter", price: "0€", period: "/mes", description: "Evalúa", features: "1 proyecto", cta: "Empezar", highlighted: false },
            { name: "Studio", price: "89€", period: "/mes", description: "Agencias", features: "10 proyectos\nReview", cta: "Probar", highlighted: true },
            { name: "Agency", price: "249€", period: "/mes", description: "Equipos", features: "Ilimitado\nAuditoría", cta: "Ventas", highlighted: false },
          ],
        }),
        c("Faq", { title: "Dudas de facturación", tone: "light", padding: "normal", items: [{ question: "¿Hay permanencia?", answer: "No." }, { question: "¿Facturáis en euros?", answer: "Sí." }] }),
        c("CtaBanner", { title: "¿Listo?", cta: "Crear cuenta", ctaHref: "#", tone: "dark" }),
        footer(),
      ],
    },
    {
      title: "Sobre nosotros", path: "about", approvalStatus: "draft",
      content: [
        navbar(),
        c("HeroMinimal", { title: "Composición gobernada desde 2026.", tone: "dark", padding: "spacious" }),
        c("Timeline", {
          title: "Historia", tone: "light", padding: "normal",
          items: [
            { date: "Ene 2026", title: "Spec v1.2", body: "Gate de validación con agencias superado." },
            { date: "Jun 2026", title: "Spikes técnicos", body: "Puck y regeneración parcial, en paralelo." },
            { date: "Próximo", title: "MVP", body: "Cockpit + Spec OS + Visual Studio." },
          ],
        }),
        c("Team", { title: "Equipo", tone: "subtle", padding: "normal", members: [{ name: "Alex", role: "Design Engineer" }, { name: "Sam", role: "Estrategia" }, { name: "Mar", role: "Contenido" }, { name: "Iván", role: "Plataforma" }] }),
        c("Quote", { quote: "La diferencia entre 'nada se regenera solo' y 'todo se puede regenerar en un clic' es el producto entero.", attribution: "Product spec, §20", tone: "subtle", padding: "normal" }),
        footer(),
      ],
    },
    {
      title: "Features", path: "features", approvalStatus: "draft",
      content: [
        navbar(),
        c("HeroSplit", { eyebrow: "Producto", title: "Un registry que escala con tu estudio", subtitle: "Secciones tipadas con variantes; el agente extiende, el humano aprueba.", tone: "light", padding: "normal", mediaSide: "right", mediaRatio: "video", cta: "Ver registry", ctaHref: "#" }),
        c("Features", {
          eyebrow: "Capacidades", title: "Lo que entra en el MVP", subtitle: "", columns: "2", tone: "subtle", padding: "normal",
          items: [
            { icon: "📐", title: "Slots", body: "Contenedores anidados sin zones legacy." },
            { icon: "🔍", title: "Búsqueda CMS", body: "El campo external busca en Payload." },
            { icon: "🧾", title: "Data JSON versionable", body: "Diff estructural por id estable." },
            { icon: "🚦", title: "Estados", body: "draft → in_review → approved." },
          ],
        }),
        c("FeatureList", { title: "Detalle", tone: "light", padding: "normal", items: [{ title: "Viewports", body: "375 / 768 / 1280 px." }, { title: "Undo/redo", body: "Historial nativo del editor." }, { title: "Publicar", body: "Snapshot inmutable como baseline del diff." }] }),
        c("Steps", { eyebrow: "Proceso", title: "Cómo se compone", tone: "light", padding: "normal", steps: [{ title: "Arrastra", body: "Secciones del registry." }, { title: "Vincula", body: "Contenido CMS real." }, { title: "Aprueba", body: "Con diff y estado." }] }),
        c("Cta", { title: "Pruébalo con tus páginas", subtitle: "", cta: "Empezar", ctaHref: "/", align: "center", tone: "subtle", padding: "normal" }),
        footer(),
      ],
    },
    {
      title: "Clientes", path: "customers", approvalStatus: "draft",
      content: [
        navbar(),
        c("Hero", { eyebrow: "Clientes", title: "Agencias que ya componen así", subtitle: "", align: "center", tone: "light", padding: "normal", size: "normal", primaryCta: "", primaryCtaHref: "", secondaryCta: "", secondaryCtaStyle: "ghost" }),
        c("TestimonialQuote", { testimonial: tRef(2), tone: "subtle", padding: "normal" }),
        c("TestimonialWall", { eyebrow: "", title: "Más voces", columns: "2", tone: "light", padding: "normal", items: [{ source: tRef(4) }, { source: tRef(5) }] }),
        c("Gallery", { title: "Trabajo reciente", columns: "3", ratio: "video", tone: "light", padding: "normal", items: [{ caption: "Rebrand Atlántica" }, { caption: "E-commerce Verda" }, { caption: "Web Museo Lume" }] }),
        c("CtaBanner", { title: "Sé el siguiente caso", cta: "Contactar", ctaHref: "/contact", tone: "brand" }),
        footer(),
      ],
    },
    {
      title: "Blog", path: "blog", approvalStatus: "draft",
      content: [
        navbar(),
        c("HeroMinimal", { title: "Notas de ingeniería y producto.", tone: "light", padding: "normal" }),
        c("PostFeature", { post: pRef(0), tone: "subtle", padding: "normal" }),
        c("BlogPosts", { title: "Últimos posts", tone: "light", padding: "normal", items: [{ source: pRef(1) }, { source: pRef(2) }, { source: pRef(3) }] }),
        c("Newsletter", { title: "Recibe lo nuevo", subtitle: "Un correo al mes.", buttonLabel: "Suscribirme", tone: "subtle", padding: "normal" }),
        footer(),
      ],
    },
    {
      title: "Contacto", path: "contact", approvalStatus: "draft",
      publishedContent: null, // never published → demo of full-diff state
      content: [
        navbar(),
        c("ContactForm", { title: "Cuéntanos tu proyecto", subtitle: "Respondemos en 24 horas laborables.", layout: "split", showPhone: true, tone: "light", padding: "spacious" }),
        c("Stats", { title: "", tone: "dark", padding: "compact", stats: [{ value: "24h", label: "respuesta" }, { value: "100%", label: "proyectos auditados" }, { value: "0", label: "CSS libre" }] }),
        footer(),
      ],
    },
    {
      title: "Términos", path: "legal/terms", approvalStatus: "draft",
      content: [
        navbar(),
        c("HeroMinimal", { title: "Términos del servicio.", tone: "light", padding: "compact" }),
        c("Section", {
          tone: "light", padding: "normal", width: "narrow",
          content: [
            c("Heading", { text: "1. Objeto", level: "h2", align: "left" }),
            c("Paragraph", { text: "Este sitio es un spike técnico desechable; nada de lo aquí escrito constituye un contrato.", size: "m", align: "left" }),
            c("Heading", { text: "2. Datos", level: "h3", align: "left" }),
            c("Paragraph", { text: "Los datos viven en un SQLite local bajo .data/ y se regeneran con npm run seed.", size: "s", align: "left" }),
          ],
        }),
        c("Section", {
          tone: "subtle", padding: "normal", width: "wide",
          content: [
            c("Columns", {
              layout: "50-50", gap: "normal",
              col1: [c("Heading", { text: "Contacto legal", level: "h4", align: "left" }), c("Paragraph", { text: "legal@estudionorte.example", size: "s", align: "left" })],
              col2: [c("ButtonRow", { buttons: [{ label: "Descargar PDF", href: "#", style: "secondary" }], align: "left" })],
              col3: [],
            }),
          ],
        }),
        c("Divider", { style: "line" }),
        footer(),
      ],
    },
  ];

  let totalSections = 0;
  let totalBytes = 0;
  for (const page of pages) {
    const data = {
      root: { props: { title: `${page.title} — Estudio Norte`, description: page.description ?? "" } },
      content: page.content,
      zones: {},
    };
    const publishedData =
      page.publishedContent === null
        ? null
        : { ...data, content: page.publishedContent ?? page.content };

    await payload.create({
      collection: "pages",
      data: {
        title: page.title,
        path: page.path,
        approvalStatus: page.approvalStatus,
        puckData: data,
        publishedData,
      },
    });

    const count = JSON.stringify(data).match(/"type":/g)?.length ?? 0;
    const bytes = Buffer.byteLength(JSON.stringify(data));
    totalSections += count;
    totalBytes += bytes;
    console.log(
      `  /${page.path.padEnd(12)} ${String(count).padStart(3)} bloques  ${(bytes / 1024).toFixed(1).padStart(6)} kB  [${page.approvalStatus}]`
    );
  }

  console.log(`\nSeed OK: ${pages.length} páginas, ${totalSections} bloques, ${(totalBytes / 1024).toFixed(1)} kB de Data JSON total.`);
  console.log(`         ${testimonials.length} testimonios y ${posts.length} posts en colecciones CMS.`);
  process.exit(0);
}

await run();
