// Shared helper: resolve CompanyProfile branding into a form react-pdf can use,
// inlining a raster logo as a data URI (react-pdf's <Image> cannot fetch
// relative URLs and cannot render SVG, so SVG keeps its original URL).
import { getCompanyProfile, getBrandingLogoBytes, type CompanyBranding } from '@/lib/branding';

export async function resolveBrandingForPdf(): Promise<any> {
  const branding: CompanyBranding = await getCompanyProfile();
  const logo = await getBrandingLogoBytes(branding);
  const brandingForPdf: any = { ...branding };
  if (logo && logo.ext !== 'svg') {
    brandingForPdf.logoUrl = `data:${logo.contentType};base64,${logo.buffer.toString('base64')}`;
  }
  return brandingForPdf;
}
