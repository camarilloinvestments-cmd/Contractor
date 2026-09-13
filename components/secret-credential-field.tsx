'use client';
// Reusable secret-credential input pattern (v1.2.0).
//
// Contract (matches the API metadata-only model):
//   * The server NEVER returns the stored secret to the browser — only a boolean
//     `configured` flag (e.g. passwordSet / credentialConfigured).
//   * When nothing is stored: shows a masked password input ("Enter password").
//   * When a secret is stored: shows "Credential configured ********" with
//     Replace and Clear actions. Clear requires a confirmation dialog.
//   * Leaving the field untouched sends an empty value, so the caller preserves
//     the existing secret on save.
//
// Reused for SMTP now and intended for IPPay, GitHub, and other integrations.
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { KeyRound, ShieldCheck, X } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

export type SecretCredentialValue = {
  password: string; // new plaintext to save ('' = no change)
  clear: boolean; // request to remove the stored secret
};

export const EMPTY_SECRET: SecretCredentialValue = { password: '', clear: false };

export function SecretCredentialField({
  label,
  configured,
  disabled,
  disabledReason,
  value,
  onChange,
  placeholder = 'Enter password',
}: {
  label: string;
  configured: boolean;
  disabled?: boolean;
  disabledReason?: string;
  value: SecretCredentialValue;
  onChange: (v: SecretCredentialValue) => void;
  placeholder?: string;
}) {
  // Show the input when nothing is stored yet, or when the user chose Replace.
  const [editing, setEditing] = useState(!configured);
  const showMasked = configured && !editing && !value.clear;

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>

      {value.clear ? (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm">
          <X className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <span className="flex-1">Credential will be cleared when you save.</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange(EMPTY_SECRET);
              setEditing(false);
            }}
          >
            Undo
          </Button>
        </div>
      ) : showMasked ? (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <ShieldCheck className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span className="flex-1">
            Credential configured <span className="font-mono tracking-widest">••••••••</span>
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => {
              setEditing(true);
              onChange(EMPTY_SECRET);
            }}
          >
            Replace
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="text-destructive">
                Clear
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear this credential?</AlertDialogTitle>
                <AlertDialogDescription>
                  The stored secret will be permanently removed when you save. Any feature that
                  depends on it will stop working until a new value is entered.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => onChange({ password: '', clear: true })}>
                  Clear credential
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <KeyRound className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="password"
              className="pl-8"
              autoComplete="new-password"
              placeholder={disabled ? disabledReason || 'Unavailable' : placeholder}
              disabled={disabled}
              value={value.password}
              onChange={(e: any) => onChange({ password: e.target.value, clear: false })}
            />
          </div>
          {configured && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(false);
                onChange(EMPTY_SECRET);
              }}
            >
              Cancel
            </Button>
          )}
        </div>
      )}

      {disabled && disabledReason && !showMasked && !value.clear && (
        <p className="text-xs text-destructive">{disabledReason}</p>
      )}
    </div>
  );
}
