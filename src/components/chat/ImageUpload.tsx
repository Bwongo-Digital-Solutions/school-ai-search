import React, { useState, useRef, useCallback } from 'react';
import { ImagePlus, X, FileImage } from 'lucide-react';

interface ImageUploadProps {
  onImageSelect: (imageData: string, fileName: string) => void;
  selectedImage: { data: string; name: string } | null;
  onClear: () => void;
}

const ImageUpload: React.FC<ImageUploadProps> = ({ onImageSelect, selectedImage, onClear }) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/') && !file.type.includes('pdf')) {
      alert('Please upload an image file (JPG, PNG, GIF) or PDF.');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      alert('File size must be less than 10MB.');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      onImageSelect(reader.result as string, file.name);
    };
    reader.readAsDataURL(file);
  }, [onImageSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [processFile]);

  if (selectedImage) {
    return (
      <div className="relative inline-flex items-center gap-2 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl px-3 py-2 border border-indigo-200 dark:border-indigo-700">
        <img
          src={selectedImage.data}
          alt="Preview"
          className="w-10 h-10 rounded-lg object-cover"
        />
        <div className="flex flex-col">
          <span className="text-xs font-medium text-indigo-700 dark:text-indigo-300 truncate max-w-[120px]">
            {selectedImage.name}
          </span>
          <span className="text-[10px] text-indigo-500">Ready to analyze</span>
        </div>
        <button
          onClick={onClear}
          className="p-1 rounded-full hover:bg-indigo-200 dark:hover:bg-indigo-800 transition-colors"
        >
          <X className="w-3.5 h-3.5 text-indigo-500" />
        </button>
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
        className="hidden"
      />
      <button
        onClick={() => fileInputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`p-2.5 rounded-xl transition-all duration-200 hover:scale-105 ${
          isDragging
            ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 ring-2 ring-indigo-300'
            : 'bg-gray-100 dark:bg-gray-700 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400'
        }`}
        title="Upload image or document"
      >
        <ImagePlus className="w-5 h-5" />
      </button>
    </>
  );
};

export default ImageUpload;
