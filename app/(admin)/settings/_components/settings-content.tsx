'use client';
import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FadeIn } from '@/components/ui/animate';
import { Building2, Mail, FileText, ScrollText, ShieldCheck, CreditCard, KeyRound, Truck, Globe, Camera } from 'lucide-react';
import { BrandingTab } from './branding-tab';
import { EmailTab } from './email-tab';
import { TemplatesTab } from './templates-tab';
import { EmailLogsTab } from './email-logs-tab';
import { SecurityTab } from './security-tab';
import { PaymentsTab } from './payments-tab';
import { ApiTab } from './api-tab';
import { IntegrationsTab } from './integrations-tab';
import { DomainSslTab } from './domain-ssl-tab';
import { WatermarkTab } from './watermark-tab';

export function SettingsContent() {
  const [tab, setTab] = useState('branding');
  return (
    <div className="p-6 space-y-6">
      <FadeIn>
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground">Company branding, email delivery, templates, delivery logs, and security</p>
        </div>
      </FadeIn>
      <Tabs value={tab} onValueChange={setTab} className="space-y-6">
        <TabsList className="grid w-full max-w-6xl grid-cols-10">
          <TabsTrigger value="branding"><Building2 className="w-4 h-4 mr-2" />Branding</TabsTrigger>
          <TabsTrigger value="email"><Mail className="w-4 h-4 mr-2" />Email</TabsTrigger>
          <TabsTrigger value="templates"><FileText className="w-4 h-4 mr-2" />Templates</TabsTrigger>
          <TabsTrigger value="payments"><CreditCard className="w-4 h-4 mr-2" />Payments</TabsTrigger>
          <TabsTrigger value="api"><KeyRound className="w-4 h-4 mr-2" />API</TabsTrigger>
          <TabsTrigger value="integrations"><Truck className="w-4 h-4 mr-2" />Geotab</TabsTrigger>
          <TabsTrigger value="watermark"><Camera className="w-4 h-4 mr-2" />Evidence</TabsTrigger>
          <TabsTrigger value="domain"><Globe className="w-4 h-4 mr-2" />Domain &amp; SSL</TabsTrigger>
          <TabsTrigger value="logs"><ScrollText className="w-4 h-4 mr-2" />Logs</TabsTrigger>
          <TabsTrigger value="security"><ShieldCheck className="w-4 h-4 mr-2" />Security</TabsTrigger>
        </TabsList>
        <TabsContent value="branding"><BrandingTab /></TabsContent>
        <TabsContent value="email"><EmailTab /></TabsContent>
        <TabsContent value="templates"><TemplatesTab /></TabsContent>
        <TabsContent value="payments"><PaymentsTab /></TabsContent>
        <TabsContent value="api"><ApiTab /></TabsContent>
        <TabsContent value="integrations"><IntegrationsTab /></TabsContent>
        <TabsContent value="watermark"><WatermarkTab /></TabsContent>
        <TabsContent value="domain"><DomainSslTab /></TabsContent>
        <TabsContent value="logs"><EmailLogsTab /></TabsContent>
        <TabsContent value="security"><SecurityTab /></TabsContent>
      </Tabs>
    </div>
  );
}
