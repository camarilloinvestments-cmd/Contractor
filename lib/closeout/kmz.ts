// KMZ generator for closeout as-built delivery.
//
// CLIENT-SAFE: contains ONLY as-built geographic data (job site + splice point
// placemarks) and company branding. NEVER includes subcontractor payouts,
// internal costs, commissions, margin, internal notes, or credentials.
//
// BRANDING: pulled from Settings -> Branding (getCompanyProfile); the logo is
// packaged inside the KMZ at assets/company-logo.png and referenced by a
// ScreenOverlay + the document description contact block. Never hard-coded.

import JSZip from 'jszip';
import { getCompanyProfile, getBrandingLogoBytes, type CompanyBranding } from '@/lib/branding';

export type KmzSplicePoint = {
  label: string;
  closureType?: string | null;
  closureId?: string | null;
  placement?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export type KmzJob = {
  jobNumber: string;
  title?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  splicePoints: KmzSplicePoint[];
};

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function contactBlock(b: CompanyBranding): string {
  const lines: string[] = [];
  if (b.legalName || b.companyName) lines.push(b.legalName || b.companyName);
  const cityLine = [b.city, b.state, b.zip].filter(Boolean).join(', ');
  if (b.address) lines.push(b.address);
  if (cityLine) lines.push(cityLine);
  if (b.phone) lines.push(`Phone: ${b.phone}`);
  if (b.email) lines.push(`Email: ${b.email}`);
  if (b.website) lines.push(b.website);
  return lines.map(xmlEscape).join('\n');
}

function placemark(sp: KmzSplicePoint): string {
  if (sp.latitude == null || sp.longitude == null) return '';
  const desc = [
    sp.closureId ? `Closure ID: ${sp.closureId}` : '',
    sp.closureType ? `Type: ${sp.closureType}` : '',
    sp.placement && sp.placement !== 'UNKNOWN' ? `Placement: ${sp.placement}` : '',
  ]
    .filter(Boolean)
    .map(xmlEscape)
    .join('\n');
  return `    <Placemark>
      <name>${xmlEscape(sp.label)}</name>
      <styleUrl>#splicePoint</styleUrl>
      <description>${desc}</description>
      <Point><coordinates>${sp.longitude},${sp.latitude},0</coordinates></Point>
    </Placemark>`;
}

function buildKml(job: KmzJob, b: CompanyBranding, hasLogo: boolean): string {
  const jobAddr = [job.address, job.city, job.state, job.zip].filter(Boolean).join(', ');
  const docName = `${b.companyName} - As-Built - Job ${job.jobNumber}`;
  const docDesc = `As-built closeout for Job ${job.jobNumber}${job.title ? ` (${job.title})` : ''}.\n\n${contactBlock(b)}`;

  const sitePlacemark =
    job.latitude != null && job.longitude != null
      ? `    <Placemark>
      <name>Job Site ${xmlEscape(job.jobNumber)}</name>
      <styleUrl>#jobSite</styleUrl>
      <description>${xmlEscape(jobAddr)}</description>
      <Point><coordinates>${job.longitude},${job.latitude},0</coordinates></Point>
    </Placemark>`
      : '';

  const splicePlacemarks = job.splicePoints.map(placemark).filter(Boolean).join('\n');

  const logoOverlay = hasLogo
    ? `    <ScreenOverlay>
      <name>${xmlEscape(b.companyName)}</name>
      <Icon><href>assets/company-logo.png</href></Icon>
      <overlayXY x="0" y="1" xunits="fraction" yunits="fraction"/>
      <screenXY x="0.02" y="0.98" xunits="fraction" yunits="fraction"/>
      <size x="0" y="0" xunits="pixels" yunits="pixels"/>
    </ScreenOverlay>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${xmlEscape(docName)}</name>
    <description>${xmlEscape(docDesc)}</description>
    <Style id="jobSite">
      <IconStyle><color>ff2e9e46</color><scale>1.2</scale>
        <Icon><href>http://maps.google.com/mapfiles/kml/shapes/target.png</href></Icon>
      </IconStyle>
    </Style>
    <Style id="splicePoint">
      <IconStyle><color>ffd8501f</color><scale>1.1</scale>
        <Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon>
      </IconStyle>
    </Style>
${logoOverlay}
${sitePlacemark}
${splicePlacemarks}
  </Document>
</kml>`;
}

// Generate the KMZ as a Buffer. Branding is fetched from Settings unless passed.
export async function generateKmz(job: KmzJob, branding?: CompanyBranding): Promise<Buffer> {
  const b = branding ?? (await getCompanyProfile());
  const logo = await getBrandingLogoBytes(b);
  const kml = buildKml(job, b, !!logo);

  const zip = new JSZip();
  zip.file('doc.kml', kml);
  if (logo) {
    // Normalize the packaged logo name; KML references assets/company-logo.png.
    zip.file('assets/company-logo.png', logo.buffer);
  }
  const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return out;
}
