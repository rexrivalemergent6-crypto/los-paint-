import { Globe, XLogo, InstagramLogo, TelegramLogo, DiscordLogo } from "@phosphor-icons/react";

const ICONS = { x: XLogo, instagram: InstagramLogo, telegram: TelegramLogo, discord: DiscordLogo };

export default function BrandLinks({ branding, className = "" }) {
  if (!branding) return null;
  const socials = branding.socials || {};
  const items = [];
  if (branding.website) items.push({ k: "website", href: branding.website, Icon: Globe });
  Object.entries(ICONS).forEach(([k, Icon]) => { if (socials[k]) items.push({ k, href: socials[k], Icon }); });
  if (!items.length) return null;
  return (
    <div data-testid="brand-links" className={`flex items-center justify-center gap-2 ${className}`}>
      {items.map(({ k, href, Icon }) => (
        <a key={k} data-testid={`brand-link-${k}`} href={href} target="_blank" rel="noreferrer"
          className="flex h-8 w-8 items-center justify-center border border-white/10 text-white/60 transition-colors hover:text-white"
          style={{ "--tw-border-opacity": 1 }}>
          <Icon className="h-4 w-4" />
        </a>
      ))}
    </div>
  );
}
