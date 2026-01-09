import React from 'react';

const DownloadButton = ({ url, filename, type = 'image' }) => {
  const handleDownload = (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Use backend proxy to download the file
    const proxyUrl = `${process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:5000'}/api/download?url=${encodeURIComponent(url)}`;
    
    // Create download link
    const link = document.createElement('a');
    link.href = proxyUrl;
    link.download = filename || `download.${type === 'image' ? 'jpg' : 'mp4'}`;
    link.style.display = 'none';
    
    // Trigger download
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <button
      onClick={handleDownload}
              className="absolute top-2 right-2 w-8 h-8 bg-black rounded-lg flex items-center justify-center hover:bg-gray-800 transition-colors duration-200 z-[1]"
      title="Download"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7,10 12,15 17,10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
    </button>
  );
};

export default DownloadButton;
