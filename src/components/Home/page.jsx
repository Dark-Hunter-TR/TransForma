"use client";

import React, { useCallback, useState } from "react";
import { 
  Upload, 
  File as FileIcon, 
  FileText, 
  Image, 
  FileSpreadsheet, 
  FileCode,
  Download,
  X,
  CheckCircle,
  AlertCircle,
  Loader2,
  Github,
  Star
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

const FileConverter = () => {
  const [files, setFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [converting, setConverting] = useState({});
  const router = useRouter();

  
const supportedFormats = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'application/pdf': 'PDF',
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/jpg': 'JPG',
  'image/webp': 'WEBP',
  'image/gif': 'GIF',
  'image/bmp': 'BMP',
  'image/tiff': 'TIFF',
  'image/svg+xml': 'SVG',
  'image/x-icon': 'ICO',
  'text/yaml': 'YAML',
  'application/json': 'JSON',
  'text/plain': 'TXT',
  'application/xml': 'XML',
  'text/csv': 'CSV',
  'text/html': 'HTML',
  'text/markdown': 'MD'
};

const outputFormats = [
  'PDF', 'DOCX', 'XLSX', 'TXT', 'HTML', 'MD', 'JSON', 'XML', 'YAML', 
  'PNG', 'JPEG', 'JPG', 'WEBP', 'GIF', 'BMP', 'TIFF', 'SVG', 'ICO', 'CSV'
];


  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    addFiles(droppedFiles);
  }, []);

  const addFiles = (newFiles) => {
    if (newFiles.length === 0) return;
    
    console.log("📤 Adding files:", newFiles.map(f => f.name));
    
    const fileObjects = newFiles.map(file => ({
      id: Date.now() + Math.random(),
      file,
      name: file.name,
      size: file.size,
      type: file.type,
      status: 'ready',
      progress: 0,
      outputFormat: 'JSON'
    }));

    setFiles(prev => [...prev, ...fileObjects]);
  };

  const removeFile = (id) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const updateFileFormat = (id, format) => {
    setFiles(prev => prev.map(f => 
      f.id === id ? { ...f, outputFormat: format } : f
    ));
  };

  const convertFile = async (fileId) => {
    const file = files.find(f => f.id === fileId);
    if (!file) {
      toast.error("❌ File not found:", fileId);
      return;
    }

    console.log("🔄 Starting conversion for:", file.name, "to", file.outputFormat);

    setFiles(prev => prev.map(f => 
      f.id === fileId ? { 
        ...f, 
        status: 'converting',
        progress: 0
      } : f
    ));
    
    setConverting(prev => ({ ...prev, [fileId]: true }));

    try {
      const formData = new FormData();
      formData.append("file", file.file);
      formData.append("outputFormat", file.outputFormat.toLowerCase());
      formData.append("includeMetadata", "true");
      formData.append("quality", "90");

      console.log("📤 Sending conversion request:", {
        fileName: file.name,
        outputFormat: file.outputFormat,
        fileType: file.type,
        fileSize: file.size
      });

      const progressInterval = setInterval(() => {
        setFiles(prev => prev.map(f => 
          f.id === fileId ? { 
            ...f, 
            progress: Math.min(f.progress + Math.random() * 20, 90)
          } : f
        ));
      }, 500);

      const response = await fetch(`/api/convert`, {
        method: "POST",
        body: formData,
      });

      clearInterval(progressInterval);

      if (!response.ok) {
        const errorData = await response.json();
        
        setFiles(prev => prev.map(f =>
          f.id === fileId ? { 
            ...f, 
            status: 'error',
            progress: 0,
            errorMessage: errorData.error || "Conversion failed"
          } : f
        ));
        
        toast.error(`Conversion failed: ${errorData.error || "Unknown error"}`);
        return;
      }

      const result = await response.json();
      console.log("✅ Conversion successful:", result);

      setFiles(prev => prev.map(f =>
        f.id === fileId ? {
          ...f,
          status: 'completed',
          progress: 100,
          conversionResult: result,
          convertedName: result.fileName || `converted_${file.name}`
        } : f
      ));
      
      console.log(`✅ File converted successfully: ${result.fileName}`);

    } catch (error) {
      toast.error(`Conversion failed: ${error.message || "Network error occurred"}`);
      
      setFiles(prev => prev.map(f =>
        f.id === fileId ? { 
          ...f, 
          status: 'error',
          progress: 0,
          errorMessage: error.message || "Network error occurred"
        } : f
      ));
    } finally {
      setConverting(prev => ({ ...prev, [fileId]: false }));
    }
  };

  const downloadFile = async (file) => {
    console.log("📥 Starting download for:", file.name);
    
    if (!file.conversionResult) {
      toast.error("No conversion result found");
      return;
    }

    try {
      const response = await fetch(`/api/convert?id=${file.conversionResult.downloadId}`, {
        method: "GET"
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to download file");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = file.convertedName || `converted_${file.name}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      URL.revokeObjectURL(url);
      
      console.log("✅ Download completed successfully");

    } catch (error) {
      toast.error(`Download failed: ${error.message}`);
    }
  };

  const convertAllFiles = () => {
    files.forEach(file => {
      if (file.status === 'ready') {
        setTimeout(() => convertFile(file.id), Math.random() * 1000);
      }
    });
  };

  const getFileIcon = (type) => {
    if (type?.startsWith('image/')) return <Image className="w-5 h-5 text-blue-400" />;
    if (type?.includes('spreadsheet') || type?.includes('csv')) return <FileSpreadsheet className="w-5 h-5 text-green-400" />;
    if (type?.includes('document')) return <FileText className="w-5 h-5 text-purple-400" />;
    if (type?.includes('pdf')) return <File className="w-5 h-5 text-red-400" />;
    if (type?.includes('yaml') || type?.includes('json') || type?.includes('xml')) return <FileCode className="w-5 h-5 text-yellow-400" />;
    if (type?.includes('svg')) return <File className="w-5 h-5 text-orange-400" />;
    if (type?.includes('text') || type?.includes('plain')) return <FileText className="w-5 h-5 text-gray-400" />;
    if (type?.includes('csv')) return <FileSpreadsheet className="w-5 h-5 text-blue-400" />;
    if (type?.includes('docx')) return <FileText className="w-5 h-5 text-purple-400" />;
    if (type?.includes('xlsx')) return <FileSpreadsheet className="w-5 h-5 text-green-400" />;
    if (type?.includes('pdf')) return <File className="w-5 h-5 text-red-400" />;
    if (type?.includes('json')) return <FileCode className="w-5 h-5 text-yellow-400" />;
    if (type?.includes('yaml')) return <FileCode className="w-5 h-5 text-yellow-400" />;
    if (type?.includes('xml')) return <FileCode className="w-5 h-5 text-yellow-400" />;
    if (type?.includes('svg')) return <File className="w-5 h-5 text-orange-400" />;
    if (type?.includes('txt')) return <FileText className="w-5 h-5 text-gray-400" />;
    if (type?.includes('csv')) return <FileSpreadsheet className="w-5 h-5 text-blue-400" />;
    if (type?.includes('doc')) return <FileText className="w-5 h-5 text-purple-400" />;
    if (type?.includes('html')) return <FileCode className="w-5 h-5 text-gray-400" />;
    if (type?.includes('md')) return <FileCode className="w-5 h-5 text-gray-400" />;
    if (type?.includes('audio') || type?.includes('mp3') || type?.includes('wav')) return <File className="w-5 h-5 text-gray-400" />;
    if (type?.includes('video') || type?.includes('mp4') || type?.includes('avi')) return <File className="w-5 h-5 text-gray-400" />;
    if (type?.includes('code') || type?.includes('script')) return <FileCode className="w-5 h-5 text-gray-400" />;
    return <FileCode className="w-5 h-5 text-gray-400" />;
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const createTestFile = () => {
    const testContent = "SA\nMerhaba Dünya!\nBu bir test dosyasıdır.\nTürkçe karakterler: ğüşıöç\nÖzel karakterler: @#$%^&*()";
    const blob = new Blob([testContent], { type: 'text/plain' });
    const file = new File([blob], 'test.txt', { type: 'text/plain' });
    addFiles([file]);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-12 relative">

          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-blue-600 to-purple-700 rounded-2xl mb-6 shadow-2xl">
            <Upload className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-4xl font-bold text-white mb-4">
            Advanced File Converter
          </h1>
          <p className="text-xl text-gray-300 max-w-2xl mx-auto mb-6">
            Convert your files while preserving content. Perfect for TXT to JSON/YAML conversions.
          </p>
          
          {/* Test Button */}
          <button 
            onClick={createTestFile}
            className="mb-6 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
          >
            🧪 Create Test TXT File
          </button>
          
          {/* GitHub Banner */}
          <div className="inline-flex items-center space-x-4 bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-2xl px-6 py-3" onClick={() => router.push('https://github.com/Dark-Hunter-TR/TransForma')}>
            <Github className="w-5 h-5 text-gray-300" />
            <span className="text-gray-300">Content-Preserving Conversion</span>
            <button className="inline-flex items-center px-3 py-1 bg-gray-700 text-gray-200 text-sm rounded-lg hover:bg-gray-600 transition-colors">
              <Star className="w-4 h-4 mr-1" />
              Enhanced
            </button>
          </div>
        </div>



        {/* Upload Area */}
        <div
          className={`relative border-3 border-dashed rounded-3xl p-12 mb-8 transition-all duration-300 ${
            isDragging 
              ? 'border-blue-400 bg-blue-900/30 scale-105 shadow-2xl' 
              : 'border-gray-600 bg-gray-800/50 backdrop-blur-sm hover:border-blue-500 hover:bg-blue-900/20'
          } shadow-xl`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="text-center">
            <div className={`inline-flex items-center justify-center w-20 h-20 rounded-full mb-6 transition-all duration-300 ${
              isDragging ? 'bg-blue-600 scale-110 shadow-xl' : 'bg-gray-700'
            }`}>
              <Upload className={`w-10 h-10 transition-colors duration-300 ${
                isDragging ? 'text-white' : 'text-gray-300'
              }`} />
            </div>
            <h3 className="text-2xl font-semibold text-white mb-2">
              Drag & Drop Files Here
            </h3>
            <p className="text-gray-400 mb-6">Content will be preserved during conversion</p>
            <label className="inline-flex items-center px-8 py-4 bg-gradient-to-r from-blue-600 to-purple-700 text-white rounded-2xl cursor-pointer hover:from-blue-700 hover:to-purple-800 transition-all duration-200 transform hover:scale-105 shadow-xl">
              <Upload className="w-5 h-5 mr-2" />
              Choose Files
              <input
                type="file"
                multiple
                className="hidden"
                onChange={(e) => addFiles(Array.from(e.target.files))}
                accept=".jpg,.jpeg,.png,.webp,.gif,.bmp,.tiff,.svg,.ico,.pdf,.docx,.doc,.odt,.rtf,.txt,.html,.md,.tex,.xlsx,.xls,.csv,.ods,.tsv,.json,.xml,.yaml,.yml,.zip,.rar,.7z,.tar,.gz,.js,.ts,.py,.java,.cpp,.c,.cs,.php,.rb,.go,.rs,.mp3,.wav,.flac,.aac,.ogg,.m4a,.mp4,.avi,.mov,.wmv,.flv,.mkv,.webm"
              />
            </label>
            <div className="mt-6 text-sm text-gray-400">
              Supported: TXT, DOCX, XLSX, PDF, PNG, JPEG, YAML, JSON, CSV, XML and more
            </div>
          </div>
        </div>

        {/* Files List */}
        {files.length > 0 && (
          <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-3xl shadow-2xl p-8 mb-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">Files to Convert</h2>
              <button
                onClick={convertAllFiles}
                className="flex items-center px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-700 text-white rounded-xl hover:from-green-700 hover:to-emerald-800 transition-all duration-200 transform hover:scale-105 shadow-lg"
              >
                <CheckCircle className="w-5 h-5 mr-2" />
                Convert All
              </button>
            </div>

            <div className="space-y-4">
              {files.map((file) => (
                <div
                  key={file.id}
                  className="border border-gray-600 rounded-2xl p-6 transition-all duration-200 hover:shadow-xl bg-gradient-to-r from-gray-800/80 to-gray-700/80 backdrop-blur-sm hover:border-gray-500"
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center space-x-4">
                      <div className="flex items-center justify-center w-12 h-12 bg-gray-700 rounded-xl">
                        {getFileIcon(file.type)}
                      </div>
                      <div>
                        <h3 className="font-semibold text-white truncate max-w-xs">
                          {file.name}
                        </h3>
                        <p className="text-sm text-gray-400">
                          {formatFileSize(file.size)} • {supportedFormats[file.type] || file.type}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-4">
                      {file.status === 'completed' && (
                        <div className="flex items-center text-green-400">
                          <CheckCircle className="w-5 h-5 mr-1" />
                          <span className="text-sm font-medium">Ready</span>
                        </div>
                      )}
                      {file.status === 'converting' && (
                        <div className="flex items-center text-blue-400">
                          <Loader2 className="w-5 h-5 mr-1 animate-spin" />
                          <span className="text-sm font-medium">Converting</span>
                        </div>
                      )}
                      {file.status === 'error' && (
                        <div className="flex items-center text-red-400">
                          <AlertCircle className="w-5 h-5 mr-1" />
                          <span className="text-sm font-medium">Error</span>
                        </div>
                      )}
                      <button
                        onClick={() => removeFile(file.id)}
                        className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center space-x-2">
                      <span className="text-sm text-gray-300">Output format:</span>
                      <select
                        value={file.outputFormat}
                        onChange={(e) => updateFileFormat(file.id, e.target.value)}
                        className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-sm text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        disabled={file.status === 'converting' || file.status === 'completed'}
                      >
                        {outputFormats.map(format => (
                          <option key={format} value={format}>{format}</option>
                        ))}
                      </select>
                    </div>
                    {file.status === 'ready' && (
                      <button
                        onClick={() => convertFile(file.id)}
                        className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-lg"
                      >
                        <Upload className="w-4 h-4 mr-1" />
                        Convert
                      </button>
                    )}
                    {file.status === 'completed' && (
                      <button 
                        onClick={() => downloadFile(file)}
                        className="flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors shadow-lg"
                      >
                        <Download className="w-4 h-4 mr-1" />
                        Download
                      </button>
                    )}
                  </div>

                  {file.status === 'converting' && (
                    <div className="relative">
                      <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-blue-500 to-purple-600 rounded-full transition-all duration-300 ease-out shadow-lg"
                          style={{ width: `${file.progress}%` }}
                        />
                      </div>
                      <div className="text-center mt-2 text-sm text-gray-300 font-medium">
                        {Math.round(file.progress)}%
                      </div>
                    </div>
                  )}

                  {file.status === 'error' && file.errorMessage && (
                    <div className="mt-4 p-3 bg-red-900/20 border border-red-500/20 rounded-lg">
                      <p className="text-red-400 text-sm">
                        ❌ {file.errorMessage}
                      </p>
                    </div>
                  )}

                  {file.status === 'completed' && file.conversionResult && (
                    <div className="mt-4 p-4 bg-green-900/20 border border-green-500/20 rounded-lg">
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-green-400 font-medium">Original Size:</span>
                          <p className="text-gray-300">{formatFileSize(file.conversionResult.originalSize)}</p>
                        </div>
                        <div>
                          <span className="text-green-400 font-medium">New Size:</span>
                          <p className="text-gray-300">{formatFileSize(file.conversionResult.size)}</p>
                        </div>
                        <div>
                          <span className="text-green-400 font-medium">Compression:</span>
                          <p className="text-gray-300">{file.conversionResult.compressionRatio}</p>
                        </div>
                        <div>
                          <span className="text-green-400 font-medium">Format:</span>
                          <p className="text-gray-300">{file.outputFormat}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Content Preservation Info */}
        <div className="bg-gradient-to-r from-blue-900/20 to-purple-900/20 border border-blue-500/20 rounded-2xl p-6 mb-8">
          <h3 className="text-lg font-semibold text-blue-400 mb-3">✨ Content Preservation Features</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-300">
            <div>
              <p><strong>📄 Text Files (TXT):</strong> Original content preserved in JSON/YAML with metadata</p>
              <p><strong>📊 Spreadsheets:</strong> Data structure maintained with proper headers</p>
            </div>
            <div>
              <p><strong>📝 Documents:</strong> Text content extracted and preserved</p>
              <p><strong>📈 Data Files:</strong> Original format and content maintained</p>
            </div>
          </div>
        </div>

        {/* Example Output Preview */}
        {files.some(f => f.status === 'completed') && (
          <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-2xl p-6 mb-8">
            <h3 className="text-lg font-semibold text-white mb-4">📋 Example: TXT to JSON Conversion</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h4 className="text-sm font-medium text-gray-400 mb-2">Input (test.txt):</h4>
                <pre className="bg-gray-900 p-3 rounded text-xs text-green-400 overflow-x-auto">
{`SA
Merhaba Dünya!
Bu bir test dosyasıdır.`}
                </pre>
              </div>
              <div>
                <h4 className="text-sm font-medium text-gray-400 mb-2">Output (JSON):</h4>
                <pre className="bg-gray-900 p-3 rounded text-xs text-blue-400 overflow-x-auto">
{`{
  "fileName": "test",
  "content": "SA\\nMerhaba Dünya!...",
  "lines": ["SA", "Merhaba Dünya!", ...],
  "wordCount": 6,
  "characterCount": 45
}`}
                </pre>
              </div>
            </div>
          </div>
        )}

        {/* Features Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-12">
          <div className="text-center p-8 bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-2xl shadow-xl hover:shadow-2xl transition-all hover:border-blue-600">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-900/50 rounded-2xl mb-4">
              <FileText className="w-8 h-8 text-blue-400" />
            </div>
            <h3 className="text-xl font-semibold text-white mb-2">Content Preservation</h3>
            <p className="text-gray-400">Original file content is fully preserved during conversion</p>
          </div>
          
          <div className="text-center p-8 bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-2xl shadow-xl hover:shadow-2xl transition-all hover:border-green-600">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-green-900/50 rounded-2xl mb-4">
              <CheckCircle className="w-8 h-8 text-green-400" />
            </div>
            <h3 className="text-xl font-semibold text-white mb-2">Smart Logic</h3>
            <p className="text-gray-400">Intelligent conversion rules prevent meaningless conversions</p>
          </div>
          
          <div className="text-center p-8 bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-2xl shadow-xl hover:shadow-2xl transition-all hover:border-purple-600">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-purple-900/50 rounded-2xl mb-4">
              <FileCode className="w-8 h-8 text-purple-400" />
            </div>
            <h3 className="text-xl font-semibold text-white mb-2">Rich Metadata</h3>
            <p className="text-gray-400">Detailed file information and statistics included</p>
          </div>
        </div>

        {/* Debug Info */}
        {files.length > 0 && (
          <div className="mt-8 bg-gray-900/50 border border-gray-700 rounded-xl p-4">
            <details className="text-gray-400">
              <summary className="cursor-pointer text-sm font-medium mb-2">🔍 Debug Information</summary>
              <pre className="text-xs overflow-x-auto">
                {JSON.stringify(files.map(f => ({
                  name: f.name,
                  type: f.type,
                  status: f.status,
                  outputFormat: f.outputFormat,
                  hasResult: !!f.conversionResult
                })), null, 2)}
              </pre>
            </details>
          </div>
        )}

        {/* Footer */}
        <footer className="mt-16 text-center">
          <div className="inline-flex items-center space-x-6 text-gray-400">
            <div className="flex items-center space-x-2">
              <Github className="w-5 h-5" />
              <span>Enhanced File Converter</span>
            </div>
            <span>•</span>
            <span>Content-Preserving Technology</span>
            <span>•</span>
            <span>Smart Conversion Logic</span>
          </div>
          <p className="mt-4 text-sm text-gray-500">
            Perfect for converting text files while preserving all content and metadata
          </p>
        </footer>
      </div>
    </div>
  );
};

export default FileConverter;