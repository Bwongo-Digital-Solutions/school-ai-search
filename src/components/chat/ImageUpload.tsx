import React, { useState, useRef, useCallback } from 'react';
import { Button } from '@carbon/react';
import { Close, Image as ImageIcon } from '@carbon/react/icons';
import styles from './composer-widgets.module.scss';
import { useNotifications } from '@/contexts/NotificationContext';

interface ImageUploadProps {
  onImageSelect: (imageData: string, fileName: string) => void;
  selectedImage: { data: string; name: string } | null;
  onClear: () => void;
}

/**
 * Attaching a picture or a PDF to a question.
 *
 * Doubles as a drop target, because dragging a scanned report onto the composer is the obvious
 * thing to try and it costs nothing to make it work.
 */
const ImageUpload: React.FC<ImageUploadProps> = ({ onImageSelect, selectedImage, onClear }) => {
  const { notify } = useNotifications();
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/') && !file.type.includes('pdf')) {
        notify.warning('That file type is not supported', 'Attach an image (JPG, PNG, GIF) or a PDF.');
        return;
      }

      if (file.size > 10 * 1024 * 1024) {
        notify.warning('That file is too large', 'Attach one under 10MB.');
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => onImageSelect(reader.result as string, file.name);
      reader.readAsDataURL(file);
    },
    [onImageSelect],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
      // Cleared so choosing the same file twice still fires a change.
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [processFile],
  );

  if (selectedImage) {
    return (
      <div className={styles.attached}>
        <img src={selectedImage.data} alt="" className={styles.thumb} />
        <span className={styles.attachedText}>
          <span className={styles.attachedName}>{selectedImage.name}</span>
          <span className={styles.attachedHint}>Ready to read</span>
        </span>
        <Button
          hasIconOnly
          kind="ghost"
          size="sm"
          renderIcon={Close}
          iconDescription="Remove this attachment"
          tooltipPosition="top"
          onClick={onClear}
        />
      </div>
    );
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.pdf"
        onChange={handleFileSelect}
        className={styles.hiddenInput}
        tabIndex={-1}
        aria-hidden="true"
      />
      <Button
        hasIconOnly
        kind="ghost"
        size="md"
        renderIcon={ImageIcon}
        iconDescription="Attach an image or PDF"
        tooltipPosition="top"
        className={isDragging ? styles.dragging : undefined}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      />
    </>
  );
};

export default ImageUpload;
