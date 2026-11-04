# Sends a file to a Windows printer byte for byte, past the driver's own formatting.
param(
  [Parameter(Mandatory = $true)][string]$Printer,
  [Parameter(Mandatory = $true)][string]$File
)
$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class RawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DocInfo {
    [MarshalAs(UnmanagedType.LPWStr)] public string Name;
    [MarshalAs(UnmanagedType.LPWStr)] public string OutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string DataType;
  }

  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool StartDocPrinter(IntPtr handle, int level, [In] DocInfo info);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool WritePrinter(IntPtr handle, byte[] data, int count, out int written);

  public static void Send(string printer, byte[] data) {
    IntPtr handle;
    if (!OpenPrinter(printer, out handle, IntPtr.Zero)) throw new Exception("Printer not found (error " + Marshal.GetLastWin32Error() + ")");
    try {
      DocInfo info = new DocInfo { Name = "PetroPro receipt", DataType = "RAW" };
      if (!StartDocPrinter(handle, 1, info)) throw new Exception("Couldn't start the print job (error " + Marshal.GetLastWin32Error() + ")");
      try {
        if (!StartPagePrinter(handle)) throw new Exception("Couldn't start the page (error " + Marshal.GetLastWin32Error() + ")");
        int written;
        bool ok = WritePrinter(handle, data, data.Length, out written);
        EndPagePrinter(handle);
        if (!ok || written != data.Length) throw new Exception("Couldn't send the receipt (error " + Marshal.GetLastWin32Error() + ")");
      } finally {
        EndDocPrinter(handle);
      }
    } finally {
      ClosePrinter(handle);
    }
  }
}
"@

[RawPrinter]::Send($Printer, [System.IO.File]::ReadAllBytes($File))
