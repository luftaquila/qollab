import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'containers'))
from render_fast import eligible


class FastEligibility(unittest.TestCase):
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

    def test_metadata_raw_references_and_preprocessing_fall_back(self):
        for source in ['---\ntitle: Example\n---\nBody', '\\newpage',
                       'See @fig-example.', '## Heading {#sec-example}',
                       '```{=latex}\ncode\n```', '<div>Raw</div>',
                       '{{< include other.qmd >}}', '::: {.callout-note}\nNote\n:::',
                       'Footnote[^1]\n\n[^1]: Note', '$\\input{file.tex}$']:
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
