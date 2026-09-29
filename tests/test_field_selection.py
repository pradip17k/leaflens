"""Guard the experiment against hiding field errors behind dataset averages."""
import sys
from pathlib import Path
import unittest
import torch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'ml'))
from train_field_v3 import summarize
from assess_field_v3 import assess

class FieldSelectionTests(unittest.TestCase):
    def test_rejecting_all_field_diseases_does_not_look_like_success(self):
        classes=['tomato_early','potato_late','unsupported']
        rows=[dict(source='PlantVillage',label='tomato_early')]*20+[
            dict(source='PlantDoc',label='tomato_early'),dict(source='PlantDoc',label='potato_late'),
            dict(source='PlantDoc',label='unsupported')]
        wrong=torch.tensor([[10.,0.,0.]]*20+[[0.,0.,10.]]*3)
        right=wrong.clone();right[20]=torch.tensor([10.,0.,0.]);right[21]=torch.tensor([0.,10.,0.])
        a=summarize(wrong,rows,classes);b=summarize(right,rows,classes)
        self.assertGreater(a['accuracy'],.9)
        self.assertEqual(a['field_supported']['accuracy'],0)
        self.assertGreater(b['selection_score'],a['selection_score']+.5)

    def test_unsupported_and_wrong_crop_are_not_accepted(self):
        classes=['tomato_early','potato_late','unsupported']
        rows=[dict(source='PlantDoc',true_label='tomato_early',logits=[0,20,0]),
              dict(source='PlantDoc',true_label='potato_late',logits=[0,20,0]),
              dict(source='PlantDoc',true_label='unsupported',logits=[20,0,0]),
              dict(source='PlantDoc',true_label='unsupported',logits=[0,0,20])]
        result=assess(rows,classes)
        self.assertEqual(result['supported_accuracy'],.5)
        self.assertEqual(result['supported_accepted'],1)
        self.assertEqual(result['supported_accepted_accuracy'],1)
        self.assertEqual(result['unsupported_incorrectly_accepted'],1)

if __name__=='__main__':unittest.main()
