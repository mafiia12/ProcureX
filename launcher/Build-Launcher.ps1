[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$launcherDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourcePath = Join-Path $launcherDirectory 'src\Program.cs'
$assetDirectory = Join-Path $launcherDirectory 'assets'
$iconPath = Join-Path $assetDirectory 'ProcureX.ico'
$outputPath = Join-Path $launcherDirectory 'ProcureXLauncher.exe'

New-Item -ItemType Directory -Path $assetDirectory -Force | Out-Null

$iconGenerator = @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

public static class ProcureXIconGenerator
{
    public static void Create(string target)
    {
        int[] sizes = new int[] { 16, 24, 32, 48, 64, 128, 256 };
        List<byte[]> images = new List<byte[]>();
        foreach (int size in sizes) images.Add(Render(size));
        using (FileStream stream = File.Create(target))
        using (BinaryWriter writer = new BinaryWriter(stream))
        {
            writer.Write((ushort)0);
            writer.Write((ushort)1);
            writer.Write((ushort)sizes.Length);
            int offset = 6 + (16 * sizes.Length);
            for (int i = 0; i < sizes.Length; i++)
            {
                writer.Write((byte)(sizes[i] == 256 ? 0 : sizes[i]));
                writer.Write((byte)(sizes[i] == 256 ? 0 : sizes[i]));
                writer.Write((byte)0);
                writer.Write((byte)0);
                writer.Write((ushort)1);
                writer.Write((ushort)32);
                writer.Write((uint)images[i].Length);
                writer.Write((uint)offset);
                offset += images[i].Length;
            }
            foreach (byte[] image in images) writer.Write(image);
        }
    }

    private static byte[] Render(int size)
    {
        using (Bitmap bitmap = new Bitmap(size, size, PixelFormat.Format32bppArgb))
        using (Graphics graphics = Graphics.FromImage(bitmap))
        {
            graphics.SmoothingMode = SmoothingMode.AntiAlias;
            graphics.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
            graphics.Clear(Color.Transparent);
            Rectangle bounds = new Rectangle(0, 0, size - 1, size - 1);
            using (GraphicsPath shape = RoundedRectangle(bounds, Math.Max(3, size / 5)))
            using (LinearGradientBrush gradient = new LinearGradientBrush(
                bounds, Color.FromArgb(18, 74, 146), Color.FromArgb(26, 116, 196), 45f))
            {
                graphics.FillPath(gradient, shape);
                using (Pen edge = new Pen(Color.FromArgb(90, 255, 255, 255), Math.Max(1f, size / 64f)))
                    graphics.DrawPath(edge, shape);
            }
            float fontSize = size * 0.39f;
            using (Font font = new Font("Segoe UI", fontSize, FontStyle.Bold, GraphicsUnit.Pixel))
            using (StringFormat format = new StringFormat())
            using (Brush text = new SolidBrush(Color.White))
            {
                format.Alignment = StringAlignment.Center;
                format.LineAlignment = StringAlignment.Center;
                graphics.DrawString("PX", font, text, new RectangleF(0, -size * 0.02f, size, size), format);
            }
            using (MemoryStream memory = new MemoryStream())
            {
                bitmap.Save(memory, ImageFormat.Png);
                return memory.ToArray();
            }
        }
    }

    private static GraphicsPath RoundedRectangle(Rectangle bounds, int radius)
    {
        int diameter = radius * 2;
        GraphicsPath path = new GraphicsPath();
        path.AddArc(bounds.Left, bounds.Top, diameter, diameter, 180, 90);
        path.AddArc(bounds.Right - diameter, bounds.Top, diameter, diameter, 270, 90);
        path.AddArc(bounds.Right - diameter, bounds.Bottom - diameter, diameter, diameter, 0, 90);
        path.AddArc(bounds.Left, bounds.Bottom - diameter, diameter, diameter, 90, 90);
        path.CloseFigure();
        return path;
    }
}
'@

Add-Type -TypeDefinition $iconGenerator -ReferencedAssemblies System.Drawing
[ProcureXIconGenerator]::Create($iconPath)

$compilerCandidates = @(
    "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)
$compiler = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $compiler) {
    throw 'The Windows .NET Framework C# compiler was not found.'
}

& $compiler /nologo /target:winexe /optimize+ /platform:anycpu `
    "/win32icon:$iconPath" `
    "/out:$outputPath" `
    /reference:System.dll `
    /reference:System.Core.dll `
    /reference:System.Drawing.dll `
    /reference:System.Windows.Forms.dll `
    $sourcePath

if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $outputPath)) {
    throw 'ProcureXLauncher.exe compilation failed.'
}

Write-Host "Built $outputPath"
Write-Host "Icon  $iconPath"
