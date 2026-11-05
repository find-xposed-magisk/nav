// 天气卡编辑抽屉：仅暴露标题字段，其余参数全部由组件按访客 IP 实时解析。
// Weather drawer: only the title is editable; everything else is resolved from the visitor IP.

import { Component, EventEmitter, Output } from '@angular/core'
import { FormsModule, ReactiveFormsModule } from '@angular/forms'
import { $t } from 'src/locale'
import { FormBuilder, FormGroup } from '@angular/forms'
import { NzDrawerModule } from 'ng-zorro-antd/drawer'
import { NzFormModule } from 'ng-zorro-antd/form'
import { NzButtonModule } from 'ng-zorro-antd/button'
import { NzInputModule } from 'ng-zorro-antd/input'

@Component({
  standalone: true,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    NzDrawerModule,
    NzFormModule,
    NzButtonModule,
    NzInputModule,
  ],
  selector: 'weather-drawer',
  templateUrl: './index.component.html',
  styleUrls: ['./index.component.scss'],
})
export class WeatherDrawerComponent {
  @Output() ok = new EventEmitter<void>()

  $t = $t
  visible = false
  validateForm!: FormGroup
  index = 0

  constructor(private fb: FormBuilder) {
    this.validateForm = this.fb.group({
      title: [''],
    })
  }

  open(data: any, idx: number) {
    this.index = idx
    for (const k in data) {
      this.validateForm.get(k)?.setValue(data[k])
    }
    this.visible = true
  }

  handleClose() {
    this.visible = false
  }

  handleSubmit() {
    const values = this.validateForm.value
    this.ok.emit({
      ...values,
      index: this.index,
    })
    this.handleClose()
  }
}
