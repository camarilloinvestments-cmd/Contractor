'use client';
import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Cable, Mail, Lock, LogIn, ShieldCheck, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export function LoginForm({ companyName = 'OS1 Fiber Track Pro' }: { companyName?: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mfaChallenge, setMfaChallenge] = useState(false);
  const [useRecovery, setUseRecovery] = useState(false);
  const [totp, setTotp] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const router = useRouter();

  const doSignIn = async (extra: Record<string, string> = {}) => {
    const result = await signIn('credentials', {
      email,
      password,
      ...extra,
      redirect: false,
    });
    if (result?.error) {
      setError(mfaChallenge ? 'Invalid authentication code' : 'Invalid email or password');
    } else {
      router.replace('/');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (!mfaChallenge) {
        // First phase: verify credentials and find out whether MFA is required.
        const res = await fetch('/api/auth/mfa/precheck', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const d = await res.json();
        if (!d?.ok) {
          setError('Invalid email or password');
          return;
        }
        if (d.mfaChallenge) {
          setMfaChallenge(true);
          return;
        }
        await doSignIn();
      } else {
        // Second phase: submit the TOTP or a recovery code.
        if (useRecovery) {
          if (!recoveryCode.trim()) { setError('Enter a recovery code'); return; }
          await doSignIn({ recoveryCode: recoveryCode.trim() });
        } else {
          if (totp.trim().length < 6) { setError('Enter the 6-digit code'); return; }
          await doSignIn({ totp: totp.trim() });
        }
      }
    } catch {
      setError('Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-background to-cyan-50 p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto w-14 h-14 bg-primary rounded-xl flex items-center justify-center mb-2">
            <Cable className="w-7 h-7 text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl font-display tracking-tight">{companyName}</CardTitle>
          <CardDescription>
            {mfaChallenge ? 'Enter your two-factor authentication code' : 'Sign in to manage your fiber construction projects'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-lg">
                {error}
              </div>
            )}

            {!mfaChallenge ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@company.com"
                      value={email}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                      className="pl-10"
                      required
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="password"
                      type="password"
                      placeholder="Enter password"
                      value={password}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                      className="pl-10"
                      required
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                {!useRecovery ? (
                  <div className="space-y-2">
                    <Label htmlFor="totp">Authentication code</Label>
                    <div className="relative">
                      <ShieldCheck className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="totp"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        placeholder="000000"
                        value={totp}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        className="pl-10 text-center tracking-[0.4em] font-mono"
                        autoFocus
                      />
                    </div>
                    <button type="button" className="text-xs text-primary hover:underline" onClick={() => { setUseRecovery(true); setError(''); }}>
                      Use a recovery code instead
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="recovery">Recovery code</Label>
                    <div className="relative">
                      <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="recovery"
                        placeholder="XXXX-XXXX-XXXX"
                        value={recoveryCode}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRecoveryCode(e.target.value)}
                        className="pl-10 font-mono"
                        autoFocus
                      />
                    </div>
                    <button type="button" className="text-xs text-primary hover:underline" onClick={() => { setUseRecovery(false); setError(''); }}>
                      Use an authenticator code instead
                    </button>
                  </div>
                )}
              </>
            )}

            <Button type="submit" className="w-full" disabled={loading} loading={loading}>
              <LogIn className="w-4 h-4 mr-2" />
              {mfaChallenge ? 'Verify' : 'Sign In'}
            </Button>

          </form>
        </CardContent>
      </Card>
    </div>
  );
}
