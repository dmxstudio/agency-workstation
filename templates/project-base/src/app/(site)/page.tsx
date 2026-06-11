import type { Metadata } from "next";
import { siteConfig } from "@site-config";
import { getPageByPath } from "@/lib/pages";
import { pageMetadata, PublishedPage } from "@/components/published-page";

export const dynamic = "force-dynamic";

/** Root URL — renders the page configured as home in site.config.ts. */

export async function generateMetadata(): Promise<Metadata> {
  const page = await getPageByPath(siteConfig.homePath);
  return pageMetadata(page);
}

export default async function HomePage() {
  const page = await getPageByPath(siteConfig.homePath);

  if (!page || (!page.publishedData && !page.puckData)) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col items-center justify-center gap-3 px-6 text-center font-sans">
        <h1 className="text-2xl font-bold tracking-tight">{siteConfig.name}</h1>
        <p className="text-sm text-neutral-600">
          Todavía no hay una página publicada en{" "}
          <code className="font-mono">/{siteConfig.homePath}</code>. Ejecuta{" "}
          <code className="font-mono">npm run seed</code> para cargar el contenido de
          ejemplo, o crea la página desde <code className="font-mono">/edit</code>.
        </p>
      </main>
    );
  }

  return <PublishedPage page={page} />;
}
