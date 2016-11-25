// Text gesture behavior:
// * Hover over empty cell: show text highlight for that cell.
// * Hover over cell with text:
//   * Change cursor to text cursor.
//   * Show "delete" and "resize" buttons.
// * Start clicking empty cell: show hover
// * Start clicking empty cell: change cursor to move cursor after short delay.
// * Drag empty cell: show text highlight for all cells between the first cell
//   and that cell, unless it's illegal (there's already a text cell
//   in-between) and then either show the hover for the first cell only, or for
//   some subset of the square.
// * Drag text cell: move the entire text around.
class TextGesture extends Gesture {
  constructor() {
    super();
    // The cell currently being hovered.
    this.hoveredCell_ = null;
    // The cell we are targeting; either equal to hoveredCell or adjacent to it
    // if the hovered cell is not a primary cell.
    this.targetCell_ = null;
    // Gesture mode, one of 'adding', 'editing' and 'removing'.
    this.mode_ = null;
    // Cell in which the gesture started.
    this.anchorCell_ = null;
    // The top-left text cell; contains the text content.
    this.startCell_ = null;
    // The bottom-right text cell; to be referred by startCell_'s content.
    this.endCell_ = null;
    // All cells belonging to the text, except the top-left one.
    this.nonStartCells_ = [];
    // The end cell when the gesture started, if any.
    this.originalEndCell_ = null;

    // Owned elements.

    // Textarea - created when editing the text.
    this.textarea_ = null;
    // Widget appearing on hover, for 'text' cursor and start-edit-on-click.
    this.hoverWidget_ = null;
    // Widget appearing on hover, for deleting the text.
    this.deleteWidget_ = null;
    // Widget appearing on hover, for resizing the text.
    this.resizeWidget_ = null;
  }

  startHover(cell) {
    if (this.textarea_) {
      // As long as there's an edit in progress, hovering changes are disabled.
      return;
    }

    if (this.mode_ != 'removing' && this.mode_ != 'resizing') {
      if (this.hoveredCell_ == cell) return;
      this.stopHover();
      this.hoveredCell_ = cell;
      this.calculateTargetCell_();
      if (!this.targetCell_) return;
      this.mode_ =
          this.targetCell_.hasLayerContent(ct.text) ? 'editing' : 'adding';
      this.calculateTextExtent_(true);
      if (!this.startCell_) return;
    } else {
      this.hoveredCell_ = cell;
    }

    this.showHighlight_();
    if (this.mode_ == 'editing') {
      this.createHoverWidget_();
      this.createDeleteWidget_();
      this.createResizeWidget_();
    }
  }

  stopHover() {
    if (this.textarea_) {
      // There's an edit in progress - do not cancel the hover artifacts.
      return;
    }

    if (this.startCell_) {
      this.hideHighlight_();
    }

    this.removeHoverWidget_();
    this.removeDeleteWidget_();
    this.removeResizeWidget_();
  }

  startGesture() {
    this.finishEditing_();

    if (!this.startCell_) {
      return;
    }

    switch (this.mode_) {
      case 'adding':
        this.anchorCell_ = this.targetCell_;
        this.showHighlight_();
        break;
      case 'removing':
        this.apply_();
        break;
      case 'editing':
        // Do nothing; this is handled by the hover widget.
        break;
      case 'resizing':
        // Do nothing; everything should already be pre-set.
        break;
    }
  }

  continueGesture(cell) {
    if (this.textarea_) {
      // There's an edit in progress, do not allow continuing the gesture.
      return;
    }

    if (this.mode_ == 'adding' || this.mode_ == 'resizing') {
      this.hideHighlight_();
      this.hoveredCell_ = cell;
      if (this.hoveredCell_.role != 'primary') {
        if (this.mode_ == 'resizing');
        this.showHighlight_();
        return;
      }
      this.targetCell_ = this.hoveredCell_;
      this.calculateTextExtent_();
      this.showHighlight_();
      if (this.mode_ == 'resizing') {
        // Redraw the resize widget so it would appear on the new corner.
        this.removeResizeWidget_();
        this.createResizeWidget_();
      }
    }
  }

  stopGesture() {
    if ((this.mode_ == 'adding' || this.mode_ == 'resizing')
        && this.startCell_) {
      this.stopHover();
      this.apply_();
      this.anchorCell_ = null;
      if (this.mode_ == 'adding') {
        this.startEditing_();
      } else {
        state.recordOperationComplete();
      }
    }
    this.mode_ = null;
  }

  // Assumes
  //   this.hoveredCell_
  // Sets
  //   this.targetCell_
  calculateTargetCell_() {
    this.targetCell_ = null;
    // Hovering over a divider cell in the middle of the text behaves as if
    // hovering over the next cell.
    if (this.hoveredCell_.role == 'horizontal') {
      const topCell = this.hoveredCell_.getNeighbors('top').cells[0];
      const bottomCell = this.hoveredCell_.getNeighbors('bottom').cells[0];
      if (this.cellsBelongToSameText_(topCell, bottomCell)) {
        this.targetCell_ = bottomCell;
      }
    } else if (this.hoveredCell_.role == 'vertical') {
      const leftCell = this.hoveredCell_.getNeighbors('left').cells[0];
      const rightCell = this.hoveredCell_.getNeighbors('right').cells[0];
      if (this.cellsBelongToSameText_(leftCell, rightCell)) {
        this.targetCell_ = rightCell;
      }
    } else if (this.hoveredCell_.role == 'corner') {
      const topLeftCell = this.hoveredCell_.getNeighbors('top-left').cells[0];
      const bottomRightCell =
          this.hoveredCell_.getNeighbors('bottom-right').cells[0];
      if (this.cellsBelongToSameText_(topLeftCell, bottomRightCell)) {
        this.targetCell_ = bottomRightCell;
      }
    } else {
      // It's a primary cell.
      this.targetCell_ = this.hoveredCell_;
    }
  }

  // Assumes
  //   this.mode_
  //   this.targetCell_
  //   this.anchorCell_ (may be null)
  // Sets
  //   this.startCell_
  //   this.endCell_
  //   this.nonStartCells_
  calculateTextExtent_() {
    switch (this.mode_) {
      case 'removing':
        // Removing assumes the cells are already set by the parent gesture.
        break;
      case 'resizing':
      case 'adding':
        if (!this.anchorCell_) {
          this.startCell_ = this.targetCell_;
          this.nonStartCells_ = [];
          this.endCell_ = null;
        } else {
          const predicate = (cell) => {
            return !cell.hasLayerContent(ct.text) ||
                cell == this.anchorCell_ ||
                cell.getVal(ct.text, ck.startCell) == this.anchorCell_.key;
          };
          this.calculateTextExtentBetween_(
              this.anchorCell_, this.targetCell_, predicate);
        }
        break;
      case 'editing':
        this.startCell_ =
            state.theMap.cells
                .get(this.targetCell_.getVal(ct.text, ck.startCell))
            || this.targetCell_;
        this.endCell_ =
            state.theMap.cells
                .get(this.startCell_.getVal(ct.text, ck.endCell));
        this.calculateTextExtentBetween_(this.startCell_, this.endCell_);
        break;
    }
  }

  // Sets this.startCell_, this.endCell_ and this.nonStartCells_, using the
  // cells between cell1 and cell2.
  // If any of the cells fails the predicate, just sets this.startCell_ to
  // cell1.
  calculateTextExtentBetween_(cell1, cell2, predicate) {
    // First, calculate the square between the anchor and the target:
    let cells = cell1.getPrimaryCellsInSquareTo(cell2);
    if (predicate) {
      if (!cells.every(predicate)) {
        cells = [cell1];
      }
    }
    if (cells.length > 0) {
      this.startCell_ = cells[0];
      this.nonStartCells_ = cells.slice(1);
    }
    this.endCell_ = cells.length > 1 ? cells[cells.length - 1] : null;
  }

  // Assumes
  //   this.startCell_
  //   this.endCell_ (may be null)
  // Sets
  //   this.nonStartCells_ (may be empty)
  // Also, might set this.endCell_.
  calculateNonStartCells_() {
    this.nonStartCells_ = [];
    if (!this.endCell_) {
      return;
    }
    const width = this.endCell_.column - this.startCell_.column;
    const height = this.endCell_.row - this.startCell_.row;

    let rowStart = this.startCell_;
    for (let i = 0; i <= height; i++) {
      let currCell = rowStart;
      for (let j = 0; j <= width; j++) {
        if (i != 0 || j != 0) {
          // This isn't the start cell.
          if (currCell.hasLayerContent(ct.text) &&
              this.anchorCell_ &&
              currCell != this.anchorCell_ &&
              currCell.getVal(ct.text, ck.startCell) != this.anchorCell_.key) {
            // In case we encounter a textual cell in range during adding, or
            // encounter a non-owned cell during resizing, we discard all
            // non-start cells and reset the start cell to the anchor.
            this.startCell_ = this.anchorCell_;
            this.endCell_ = null;
            this.nonStartCells_ = [];
            return;
          }
          this.nonStartCells_.push(currCell);
        }
        currCell = currCell.getNeighbors('right').cells[0];
        if (!currCell) break;
      }
      rowStart = rowStart.getNeighbors('bottom').cells[0];
      if (!rowStart) break;
    }
  }

  createHoverWidget_() {
    if (this.hoverWidget_) return;
    this.hoverWidget_ = createAndAppendDivWithClass(
        this.startCell_.gridElement, 'text-hover-widget');
    this.hoverWidget_.style.left =
        this.startCell_.offsetLeft - this.startCell_.offsetLeft;
    this.hoverWidget_.style.top =
        this.startCell_.offsetTop - this.startCell_.offsetTop;
    const textElement =
        this.startCell_.getOrCreateLayerElement(
            ct.text, this.createStartCellContent_());
    this.hoverWidget_.style.width = textElement.scrollWidth;
    this.hoverWidget_.style.height = textElement.scrollHeight;
    this.hoverWidget_.onclick = (e) => {
      if (e.button == 0) this.startEditing_();
    };
    this.hoverWidget_.onmousedown = (e) => e.stopPropagation();
    this.hoverWidget_.onmouseup = (e) => e.stopPropagation();
  }

  removeHoverWidget_() {
    if (this.hoverWidget_) {
      this.hoverWidget_.parentElement.removeChild(this.hoverWidget_);
      this.hoverWidget_ = null;
    }
  }

  createDeleteWidget_() {
    if (this.deleteWidget_) return;
    this.deleteWidget_ = createAndAppendDivWithClass(
        this.startCell_.gridElement, 'text-delete-widget');
    const textElement =
        this.startCell_.getOrCreateLayerElement(
            ct.text, this.createStartCellContent_());
    this.deleteWidget_.style.left = textElement.scrollWidth;
    const deleteGesture = new TextGesture();
    deleteGesture.mode_ = 'removing';
    deleteGesture.startCell_ = this.startCell_;
    deleteGesture.endCell_ = this.endCell_;
    deleteGesture.nonStartCells_ = this.nonStartCells_;
    this.deleteWidget_.onmouseenter = (e) => {
      deleteGesture.startHover(this.startCell_);
      e.stopPropagation();
    }
    this.deleteWidget_.onmouseleave = (e) => {
      deleteGesture.stopHover();
      this.startCell_.showHighlight(
          ct.text, this.startCell_.getLayerContent(ct.text));
      e.stopPropagation();
    }
    this.deleteWidget_.onclick = (e) => {
      this.finishEditing_();
      deleteGesture.startGesture();
      deleteGesture.stopGesture();
      state.recordOperationComplete();
      e.stopPropagation();
      this.stopHover();
      this.startHover(this.startCell_);
    };
    this.deleteWidget_.onmousedown = (e) => e.stopPropagation();
    this.deleteWidget_.onmouseup = (e) => e.stopPropagation();
  }

  removeDeleteWidget_() {
    if (this.deleteWidget_) {
      this.deleteWidget_.parentElement.removeChild(this.deleteWidget_);
      this.deleteWidget_ = null;
    }
  }

  createResizeWidget_() {
    if (this.resizeWidget_) return;
    this.resizeWidget_ = createAndAppendDivWithClass(
        this.startCell_.gridElement, 'text-resize-widget');
    const textElement =
        this.startCell_.getOrCreateLayerElement(
            ct.text, this.createStartCellContent_());
    this.resizeWidget_.style.left = textElement.scrollWidth;
    this.resizeWidget_.style.top = textElement.scrollHeight;
    this.resizeWidget_.onmouseenter = (e) => e.stopPropagation();
    this.resizeWidget_.onmouseleave = (e) => e.stopPropagation();
    this.resizeWidget_.onmouseup = (e) => e.stopPropagation();
    this.resizeWidget_.onmousedown = (e) => {
      this.removeHoverWidget_();
      this.removeDeleteWidget_();
      this.anchorCell_ = this.startCell_;
      this.originalEndCell_ = this.endCell_;
      this.mode_ = 'resizing';
      e.stopPropagation();
    }
  }

  removeResizeWidget_() {
    if (this.resizeWidget_) {
      this.resizeWidget_.parentElement.removeChild(this.resizeWidget_);
      this.resizeWidget_ = null;
    }
  }

  cellsBelongToSameText_(topLeftCell, bottomRightCell) {
    if (!topLeftCell || !bottomRightCell) return false;
    const content1 = topLeftCell.getLayerContent(ct.text);
    const content2 = bottomRightCell.getLayerContent(ct.text);
    if (!content1 || !content2) return false;
    if (!content2[ck.startCell]) return false;

    return content2[ck.startCell] == topLeftCell.key ||
      content2[ck.startCell] == content1[ck.startCell];
  }

  startEditing_() {
    this.finishEditing_();
    const startCell = this.startCell_;
    this.createDeleteWidget_();
    this.createResizeWidget_();
    const textElement =
        this.startCell_.getOrCreateLayerElement(
            ct.text, this.createStartCellContent_());
    this.textarea_ = document.createElement('textarea');
    this.textarea_.className = 'text-cell-textarea';
    this.textarea_.style.width = textElement.offsetWidth + 2;
    this.textarea_.style.height = textElement.offsetHeight + 2;
    if (startCell.hasLayerContent(ct.text)) {
      this.textarea_.value = startCell.getVal(ct.text, ck.text);
    }
    startCell.gridElement.appendChild(this.textarea_);
    this.textarea_.onkeyup = (e) => {
      if (e.key == 'Escape') {
        this.finishEditing_();
        return;
      }
      const text = this.textarea_.value;
      const content = startCell.getLayerContent(ct.text);
      if (text && content) {
        // Changing existing text - just update the start cell content.
        content[ck.text] = text;
        startCell.setLayerContent(ct.text, content, true);
      } else if (!text && !content) {
        // Removing all text when there's already none.
        return;
      } else {
        // We get here if !!text != !!content. In that case we update all
        // affected cells.
        const startCellContent = text ? {
          [ck.kind]: ct.text.text.id,
          [ck.variation]: ct.text.text.standard.id,
          [ck.text]: text,
        } : null;
        if (startCellContent && this.nonStartCells_.length > 0) {
          startCellContent[ck.endCell] =
              this.nonStartCells_[this.nonStartCells_.length - 1].key;
        }
        this.startCell_.setLayerContent(
            ct.text, text ? startCellContent : null, true);
        this.nonStartCells_.forEach(nonStartCell => {
          nonStartCell.setLayerContent(ct.text, text ? {
            [ck.kind]: ct.text.text.id,
            [ck.variation]: ct.text.text.standard.id,
            [ck.startCell]: this.startCell_.key,
          } : null, true);
        });
      }
      const startCellElement =
          startCell.getOrCreateLayerElement(ct.text, content);
      this.textarea_.style.fontSize = startCellElement.style.fontSize;
      if (startCell.textHeight) {
        const whitespace =
            startCellElement.scrollHeight - startCell.textHeight;
        this.textarea_.style.paddingTop = (whitespace / 2 + 1) + 'px';
      }
    }
    this.textarea_.onmousedown = (e) => e.stopPropagation();
    this.textarea_.onmouseup = (e) => e.stopPropagation();
    const content = startCell.getLayerContent(ct.text);
    if (content) {
      const startCellElement =
          startCell.getOrCreateLayerElement(ct.text, content);
      this.textarea_.style.fontSize = startCellElement.style.fontSize;
      if (startCell.textHeight) {
        const whitespace =
            startCellElement.scrollHeight - startCell.textHeight;
        this.textarea_.style.paddingTop = (whitespace / 2 + 1) + 'px';
      }
    }
    this.textarea_.focus();
    this.textarea_.select();
  }

  finishEditing_() {
    if (this.textarea_) {
      this.textarea_.parentElement.removeChild(this.textarea_);
      this.textarea_ = null;
    }
    this.stopHover();
    state.recordOperationComplete();
  }

  isCellEligible_(cell) {
    return cell && cell.role == 'primary';
  }

  showHighlight_() {
    this.startCell_.showHighlight(ct.text, this.createStartCellContent_());
    this.nonStartCells_.forEach(nonStartCell => {
      nonStartCell.showHighlight(ct.text, this.createNonStartCellContent_());
    });
  }

  hideHighlight_() {
    this.startCell_.hideHighlight(ct.text);
    this.nonStartCells_.forEach(nonStartCell => {
      nonStartCell.hideHighlight(ct.text);
    });
  }

  apply_() {
    this.startCell_.setLayerContent(
        ct.text, this.createStartCellContent_(), true);
    this.nonStartCells_.forEach(nonStartCell => {
      nonStartCell.setLayerContent(
          ct.text, this.createNonStartCellContent_(), true);
    });
    // Finally, for resize gestures, remove text from cells that were removed
    // by this gesture. The original startcell is the anchor (because it's a
    // resize), and the original endcell is stored in originalEndCell_.
    if (this.originalEndCell_) {
      this.anchorCell_.getPrimaryCellsInSquareTo(this.originalEndCell_)
          .forEach(cell => {
            if (cell != this.startCell_ &&
                !this.nonStartCells_.includes(cell)) {
              cell.setLayerContent(ct.text, null);
            }
          });
    }
  }

  createStartCellContent_() {
    let text = 'Text';
    switch (this.mode_) {
      case 'removing':
        return null;
      case 'editing':
        return this.startCell_.getLayerContent(ct.text);
      case 'resizing':
        text = this.anchorCell_.getVal(ct.text, ck.text);
        // Intentional fallthrough.
      case 'adding':
        const content = {
          [ck.kind]: ct.text.text.id,
          [ck.variation]: ct.text.text.standard.id,
          [ck.text]: text,
        };
        if (this.endCell_) {
          content[ck.endCell] = this.endCell_.key;
        }
        return content;
    }
  }

  createNonStartCellContent_() {
    switch (this.mode_) {
      case 'removing':
        return null;
      case 'resizing':
      case 'editing':
      case 'adding':
        return {
          [ck.kind]: ct.text.text.id,
          [ck.variation]: ct.text.text.standard.id,
          [ck.startCell]: this.startCell_.key,
        };
    }
  }
}