import pathlib
import sys
import unittest
import subprocess

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'containers'))
from render_fast import eligible, wait


class FastEligibility(unittest.TestCase):
    def test_exit_and_timeout_waits(self):
        process = subprocess.Popen([sys.executable, '-c', 'pass'])
        self.assertEqual(wait(process, 3), 0)
        process = subprocess.Popen([sys.executable, '-c', 'import time;time.sleep(10)'])
        try:
            with self.assertRaises(subprocess.TimeoutExpired):wait(process, .02)
        finally:
            process.kill();process.wait()

    def job(self, source):
        return {'target': 'report.qmd', 'files': [
            {'path': 'report.qmd', 'source': source},
            {'path': 'assets/figure.png', 'bytes': 'aW1hZ2U='},
        ]}

    def test_basic_visual_content(self):
        self.assertTrue(eligible(self.job(
            '# 한글\n\n**Bold** and *italic*, $E=mc^2$.\n\n'
            '| A | B |\n|---|---|\n| 한글 | 표 |\n\n'
            '![그림](assets/figure.png){width=25%}\n')))
        self.assertTrue(eligible(self.job('$$\\frac{1}{3} + \\int_0^1 x^2 dx$$')))

    def test_metadata_raw_references_and_preprocessing_fall_back(self):
        for source in ['---\ntitle: Example\n---\nBody', '\\newpage',
                       'See @fig-example.', '## Heading {#sec-example}',
                       '```{=latex}\ncode\n```', '<div>Raw</div>',
                       '{{< include other.qmd >}}', '::: {.callout-note}\nNote\n:::',
                       'Footnote[^1]\n\n[^1]: Note', '$\\input{file.tex}$',
                       '$^^5cinput{file.tex}$', '$\\csname input\\endcsname$']:
            with self.subTest(source=source):
                self.assertFalse(eligible(self.job(source)))

    def test_project_configuration_and_nondefault_target_fall_back(self):
        for name in ['_quarto.yml', 'chapter/_metadata.yml', 'refs.bib', 'extra.tex']:
            job = self.job('Text')
            job['files'].append({'path': name, 'source': ''})
            self.assertFalse(eligible(job))
        job = self.job('Text')
        job['target'] = 'nested/report.qmd'
        self.assertFalse(eligible(job))
        self.assertFalse(eligible(self.job('가' * 34_000)))
        job = self.job('Text')
        job['files'][0] = {'path': 'report.qmd', 'bytes': 'VGV4dA=='}
        self.assertFalse(eligible(job))


if __name__ == '__main__':
    unittest.main()
