import React, { useState } from 'react';
import {
  Button,
  ContentSwitcher,
  InlineLoading,
  InlineNotification,
  Modal,
  PasswordInput,
  Switch,
  TextInput,
} from '@carbon/react';
import { Education } from '@carbon/react/icons';
import { useAuth } from '@/contexts/AuthContext';
import styles from './auth-modal.module.scss';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Signing in, and signing up.
 *
 * One dialog for both, switched at the top, because on a school system the two are the same errand:
 * somebody is trying to get in and does not yet know which of the two they need. Carbon's Modal
 * carries the focus trap and Escape handling; `TextInput type="password"` brings its own show/hide
 * toggle, which is why there is no eye button in this file any more.
 */
const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  if (!isOpen) return null;

  const resetForm = () => {
    setEmail('');
    setPassword('');
    setDisplayName('');
    setError('');
    setSuccess('');
  };

  const switchMode = (next: 'signin' | 'signup') => {
    setMode(next);
    resetForm();
  };

  const handleSubmit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      if (mode === 'signin') {
        if (!email || !password) {
          setError('Enter your email and password.');
          setLoading(false);
          return;
        }
        const result = await signIn(email, password);
        if (result.success) {
          setSuccess('Signed in.');
          setTimeout(() => {
            onClose();
            resetForm();
          }, 800);
        } else {
          setError(result.error || 'Could not sign in');
        }
      } else {
        if (!email || !password || !displayName) {
          setError('Fill in every field.');
          setLoading(false);
          return;
        }
        if (password.length < 6) {
          setError('Use a password of at least six characters.');
          setLoading(false);
          return;
        }
        const result = await signUp(email, password, displayName);
        if (result.success && result.pending) {
          // A pending account is not signed in — the dialog stays open so the person sees why.
          setSuccess('Account created. An administrator has to approve it before you can sign in.');
          setEmail('');
          setPassword('');
          setDisplayName('');
        } else if (result.success) {
          setSuccess('Account created.');
          setTimeout(() => {
            onClose();
            resetForm();
          }, 800);
        } else {
          setError(result.error || 'Could not create the account');
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something unexpected went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open
      className={styles.modal}
      modalHeading={
        <div className={styles.banner}>
          <span className={styles.bannerMark}>
            <Education size={20} />
          </span>
          <span>
            <span className={styles.bannerTitle}>
              {mode === 'signin' ? 'Welcome back' : 'Create an account'}
            </span>
            <span className={styles.bannerSub}>
              {mode === 'signin' ? 'Sign in to SchoolBot' : 'Join your school on SchoolBot'}
            </span>
          </span>
        </div>
      }
      primaryButtonText={
        mode === 'signin'
          ? loading
            ? 'Signing in…'
            : 'Sign in'
          : loading
            ? 'Creating…'
            : 'Create account'
      }
      secondaryButtonText="Cancel"
      primaryButtonDisabled={loading}
      onRequestSubmit={() => handleSubmit()}
      onRequestClose={onClose}
      size="sm"
    >
      <form className={styles.form} onSubmit={handleSubmit}>
        <ContentSwitcher
          className={styles.switcher}
          selectedIndex={mode === 'signin' ? 0 : 1}
          onChange={({ index }) => switchMode(index === 0 ? 'signin' : 'signup')}
          size="md"
        >
          <Switch name="signin" text="Sign in" />
          <Switch name="signup" text="Create account" />
        </ContentSwitcher>

        {error && (
          <InlineNotification
            kind="error"
            title="Could not continue"
            subtitle={error}
            onCloseButtonClick={() => setError('')}
            lowContrast
          />
        )}

        {success && (
          <InlineNotification kind="success" title={success} lowContrast hideCloseButton />
        )}

        {mode === 'signup' && (
          <TextInput
            id="auth-name"
            labelText="Your name"
            placeholder="As it should appear to colleagues"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            autoComplete="name"
          />
        )}

        <TextInput
          id="auth-email"
          type="email"
          labelText="Email address"
          placeholder="you@school.ac.ug"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
        />

        <PasswordInput
          id="auth-password"
          labelText="Password"
          placeholder={mode === 'signup' ? 'At least six characters' : 'Your password'}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          showPasswordLabel="Show password"
          hidePasswordLabel="Hide password"
        />

        {mode === 'signup' && (
          <p className={styles.note}>
            The first account created at a school becomes its administrator. Every account after that
            starts as a teacher and waits for an administrator to approve it.
          </p>
        )}

        {loading && <InlineLoading description="Working…" />}
      </form>
    </Modal>
  );
};

export default AuthModal;
